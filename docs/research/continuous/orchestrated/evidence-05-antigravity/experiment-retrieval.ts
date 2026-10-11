// Deterministic task fixtures and measurements for bounded attachment manifest and retrieval.
// Evaluates:
// 1. Current baseline attachmentInput (unbounded manifest, bounded bodies)
// 2. Naive manifest truncation (K-recent attachments) & discovery failure rates
// 3. Existing library_list tool capabilities, limits (200 item cap, no content search)
// 4. Isolated Reference Prototype: Bounded Searchable Catalog Manifest & Content Index
// Run: node --experimental-transform-types --disable-warning=ExperimentalWarning \
//   docs/research/continuous/orchestrated/evidence-05-antigravity/experiment-retrieval.ts

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../../../../src/host/store.ts'
import { AttachmentStore, type ProviderAttachment } from '../../../../../src/host/attachments.ts'
import { Hub } from '../../../../../src/host/hub.ts'
import { Library } from '../../../../../src/host/library.ts'
import { libraryTools } from '../../../../../src/host/tools/library.ts'
import { attachmentInput } from '../../../../../src/host/providers/images.ts'
import { withHandoff } from '../../../../../src/host/handoff.ts'
import { unavailableUsage, type RunRequest, type RunResult, type TurnSink } from '../../../../../src/host/providers/provider.ts'
import type { Attachment, FileAttachment, ProviderId } from '../../../../../src/shared/types.ts'

const here = new URL('.', import.meta.url).pathname
const tmp = mkdtempSync(join(tmpdir(), 'rocket-ag05-'))
const fixtures = join(tmp, 'fixtures')
execFileSync('python3', [join(here, 'make-fixtures.py'), fixtures])
const bytes = (name: string) => new Uint8Array(readFileSync(join(fixtures, name)))

class Recorder {
  ran: RunRequest[] = []
  loseNext = false
  constructor(readonly id: ProviderId) {}
  async run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
    this.ran.push(request)
    if (this.loseNext) {
      this.loseNext = false
      return { status: 'failed', sessionLost: true }
    }
    sink.session(`session-${this.id}`)
    sink.item({ type: 'assistant', id: `${request.turnId}:a`, turnId: request.turnId, text: 'ok', streaming: false })
    return { status: 'completed' }
  }
  async prepare() {}
  async stop() {}
  forget() {}
  async usage() { return unavailableUsage(this.id, 'test') }
  async models() { return [] }
  shutdown() {}
}

const store = new Store(join(tmp, 'rocket.db'))
const files = new AttachmentStore(store, join(tmp, 'attachments'))
const adapters = {
  claude: new Recorder('claude'),
  codex: new Recorder('codex'),
  cursor: new Recorder('cursor'),
  antigravity: new Recorder('antigravity')
}
const hub = new Hub(store, adapters as never, () => {}, () => {}, null, ids => files.resolve(ids))
const library = new Library(store, files, join(tmp, 'library-cache'), {
  hidden: () => false,
  changed: () => {},
  downloads: async () => []
})

async function turn(chatId: string, provider: ProviderId, text: string, attachments: Attachment[] = []) {
  const turnId = hub.send(chatId, provider, null, text, null, attachments)
  const done = await hub.waitForTurn(chatId, { turnId, timeoutMs: 10_000 })
  return { done, request: adapters[provider].ran.at(-1)! }
}

// Helpers to extract manifest metrics
function analyzeManifest(text: string) {
  const splitIndex = text.indexOf('\n\n<file ')
  const manifest = splitIndex >= 0 ? text.slice(0, splitIndex) : text
  const lines = manifest.trim() ? manifest.trim().split('\n').filter(l => l.startsWith('[File attachment ') || l.startsWith('[Image attachment ')) : []
  const bodies = (text.match(/<file name=/g) ?? []).length
  return {
    manifestChars: manifest.length,
    manifestEntries: lines.length,
    injectedBodies: bodies,
    lines
  }
}

// Reference Prototype: Bounded Searchable Manifest with an On-Disk Catalog Index
interface CatalogEntry {
  id: string
  name: string
  format: string
  size: number
  path: string
  textPath?: string
  snippet: string
  keywords: string[]
}

function buildBoundedCatalogManifest(
  attachments: ProviderAttachment[],
  catalogFilePath: string,
  recentKeepCount = 15
) {
  const recent = attachments.slice(0, recentKeepCount)
  const older = attachments.slice(recentKeepCount)

  // Recent attachments use standard attachmentInput format
  const recentInput = attachmentInput('', recent, false)

  let catalogInfo = ''
  if (older.length > 0) {
    const catalog: CatalogEntry[] = older.map(att => {
      let snippet = ''
      let keywords: string[] = []
      if ((att as FileAttachment).textPath || (att as FileAttachment).path) {
        try {
          const content = readFileSync((att as any).textPath ?? att.path, 'utf8')
          snippet = content.slice(0, 160).replace(/\s+/g, ' ').trim()
          // Extract distinctive tokens (capitalized or alphanumeric identifiers)
          const words = content.match(/[A-Za-z0-9_-]{4,}/g) ?? []
          keywords = [...new Set(words)].slice(0, 20)
        } catch {
          snippet = '[unreadable content]'
        }
      }
      return {
        id: att.id,
        name: att.name,
        format: (att as FileAttachment).format ?? 'image',
        size: att.size,
        path: att.path,
        textPath: (att as any).textPath,
        snippet,
        keywords
      }
    })
    writeFileSync(catalogFilePath, JSON.stringify(catalog, null, 2))
    catalogInfo = `\n[Earlier attachments: ${older.length} historical files indexed in catalog "${catalogFilePath}"; search with view_file or grep if needed]`
  }

  const manifestText = [recentInput.text, catalogInfo].filter(Boolean).join('\n')
  return {
    text: manifestText,
    recentCount: recent.length,
    olderIndexedCount: older.length,
    catalogChars: catalogInfo.length,
    totalPromptChars: manifestText.length
  }
}

const results: Record<string, unknown> = {}

try {
  // --------------------------------------------------------------------------
  // EXPERIMENT 1: Discovery Reachability under Truncation (N = 250 files)
  // --------------------------------------------------------------------------
  const chat1 = hub.createChat(tmp)
  const targetAncient = await files.importFile('report-ancient.txt', new TextEncoder().encode('Ancient report details: APOLLO_BUDGET_123 = $4.2M allocated to lunar orbital telemetry.'))
  const targetPdf = await files.importFile('spec-ancient.pdf', bytes('text.pdf'))
  await turn(chat1.id, 'claude', 'turn 0 - ancient text', [targetAncient])
  await turn(chat1.id, 'claude', 'turn 1 - ancient pdf', [targetPdf])

  let targetMid: FileAttachment | null = null
  for (let i = 2; i < 248; i++) {
    if (i === 125) {
      targetMid = await files.importFile('memo-mid.txt', new TextEncoder().encode('Midpoint confidential memo: ZEUS_SECRET_789 authorization granted for deployment.'))
      await turn(chat1.id, 'claude', `turn ${i}`, [targetMid])
    } else {
      const dummy = await files.importFile(`dummy-${i}.txt`, new TextEncoder().encode(`Standard log entry for turn ${i}: operational status normal.`))
      await turn(chat1.id, 'claude', `turn ${i}`, [dummy])
    }
  }

  const targetRecent = await files.importFile('contract-recent.txt', new TextEncoder().encode('Recent contract: SLA guarantees 99.99% uptime for cloud hosting services.'))
  await turn(chat1.id, 'claude', 'turn 248 - recent', [targetRecent])
  await turn(chat1.id, 'claude', 'turn 249 - latest turn', [])

  // Now trigger an Antigravity turn receiving the full handoff & attachments
  const probe = await turn(chat1.id, 'antigravity', 'retrieve targets')
  const totalAttachments = probe.request.attachments?.length ?? 0
  
  // Baseline prompt as built by adapter for the model
  const baselineInput = attachmentInput(withHandoff(probe.request.handoff, probe.request.text), probe.request.attachments, false)
  const baselineAnalysis = analyzeManifest(baselineInput.text)

  // 1.1 Baseline prompt checks
  const baselineHasRecentPath = baselineInput.text.includes(files.resolve([targetRecent.id])[0]!.path)
  const baselineHasMidPath = baselineInput.text.includes(files.resolve([targetMid!.id])[0]!.path)
  const baselineHasAncientPath = baselineInput.text.includes(files.resolve([targetAncient.id])[0]!.path)
  const baselineHasAncientPdfPath = baselineInput.text.includes(files.resolve([targetPdf.id])[0]!.path)

  // Check if bodies are inline
  const baselineHasRecentBody = baselineInput.text.includes('SLA guarantees 99.99%')
  const baselineHasMidBody = baselineInput.text.includes('ZEUS_SECRET_789')
  const baselineHasAncientBody = baselineInput.text.includes('APOLLO_BUDGET_123')

  // 1.2 Naive truncation simulation (K = 20)
  const K = 20
  const naiveAttachments = (probe.request.attachments ?? []).slice(0, K)
  const naiveInput = attachmentInput('', naiveAttachments, false)
  const naiveAnalysis = analyzeManifest(naiveInput.text)

  const naiveHasRecent = naiveInput.text.includes(targetRecent.id)
  const naiveHasMid = naiveInput.text.includes(targetMid!.id)
  const naiveHasAncient = naiveInput.text.includes(targetAncient.id)
  const naiveHasAncientPdf = naiveInput.text.includes(targetPdf.id)

  // 1.3 Available tool retrieval via library_list
  const [libListTool] = libraryTools(library, store)
  const context = { chatId: chat1.id, provider: 'antigravity' as ProviderId }

  // A. Exact filename search
  const libSearchRecent = await libListTool.run({ chat: 'this', q: 'contract-recent.txt' }, context)
  const libSearchMid = await libListTool.run({ chat: 'this', q: 'memo-mid.txt' }, context)
  const libSearchAncient = await libListTool.run({ chat: 'this', q: 'report-ancient.txt' }, context)

  // B. Content keyword search (where filename is unknown or nondescript)
  const libSearchContentMid = await libListTool.run({ chat: 'this', q: 'ZEUS_SECRET_789' }, context)
  const libSearchContentAncient = await libListTool.run({ chat: 'this', q: 'APOLLO_BUDGET_123' }, context)

  // C. General unfiltered listing (default limit 50, max 200)
  const libListDefault = await libListTool.run({ chat: 'this' }, context)
  const libListMax = await libListTool.run({ chat: 'this', limit: 200 }, context)
  const defaultListText = (libListDefault as any).content?.[0]?.text ?? ''
  const maxListText = (libListMax as any).content?.[0]?.text ?? ''

  // Does the max listing (200 entries) see ancient files? Total is 249!
  const maxListHasRecent = maxListText.includes('contract-recent.txt')
  const maxListHasMid = maxListText.includes('memo-mid.txt')
  const maxListHasAncient = maxListText.includes('report-ancient.txt')

  // D. PDF path retrieval check
  const libSearchPdf = await libListTool.run({ chat: 'this', q: 'spec-ancient.pdf' }, context)
  const pdfOutput = (libSearchPdf as any).content?.[0]?.text ?? ''
  const pdfResolved = files.resolve([targetPdf.id])[0]!
  const libGivesPdfPath = pdfOutput.includes(pdfResolved.path)
  const libGivesExtractedTextPath = pdfResolved.textPath ? pdfOutput.includes(pdfResolved.textPath) : false

  results.exp1_reachability = {
    totalAttachmentsInChat: totalAttachments,
    baseline: {
      manifestChars: baselineAnalysis.manifestChars,
      manifestEntries: baselineAnalysis.manifestEntries,
      hasRecentPath: baselineHasRecentPath,
      hasMidPath: baselineHasMidPath,
      hasAncientPath: baselineHasAncientPath,
      hasAncientPdfPath: baselineHasAncientPdfPath,
      bodiesInlined: {
        recentBodyInlined: baselineHasRecentBody,
        midBodyInlined: baselineHasMidBody,
        ancientBodyInlined: baselineHasAncientBody,
        explanation: 'Due to 120k char budget, only recent files have bodies inlined. Older files have path in manifest.'
      }
    },
    naiveTruncation_K20: {
      manifestChars: naiveAnalysis.manifestChars,
      manifestEntries: naiveAnalysis.manifestEntries,
      hasRecent: naiveHasRecent,
      hasMid: naiveHasMid,
      hasAncient: naiveHasAncient,
      hasAncientPdf: naiveHasAncientPdf,
      failureMode: 'Old files (> K) are completely missing from prompt. Undiscoverable unless exact filename is known.'
    },
    libraryListTool: {
      exactFilenameSearch: {
        recentFound: (libSearchRecent as any).content?.[0]?.text?.includes('contract-recent.txt') ?? false,
        midFound: (libSearchMid as any).content?.[0]?.text?.includes('memo-mid.txt') ?? false,
        ancientFound: (libSearchAncient as any).content?.[0]?.text?.includes('report-ancient.txt') ?? false
      },
      contentKeywordSearch: {
        midContentFound: !(libSearchContentMid as any).content?.[0]?.text?.includes('No files match'),
        ancientContentFound: !(libSearchContentAncient as any).content?.[0]?.text?.includes('No files match'),
        explanation: 'library_list only matches against [name, origin, path, chatTitle]. Content is unindexed.'
      },
      unfilteredListingCaps: {
        defaultCount: (defaultListText.match(/\|/g) ?? []).length > 0,
        maxLimitReturnedEntries: 200,
        maxListIncludesRecent: maxListHasRecent,
        maxListIncludesMid: maxListHasMid,
        maxListIncludesAncient: maxListHasAncient,
        explanation: 'At 249 attachments, LIMIT_MAX=200 strictly cuts off the oldest 49 files. Ancient files cannot be discovered without exact name query.'
      },
      pdfInspection: {
        givesPdfPath: libGivesPdfPath,
        givesExtractedTextPath: libGivesExtractedTextPath,
        explanation: 'library_list provides only entry.path (.pdf), omitting .extracted.txt.'
      }
    }
  }

  // --------------------------------------------------------------------------
  // EXPERIMENT 2: Manifest Growth vs History Depth (N = 1, 10, 50, 100, 250, 500, 1000)
  // --------------------------------------------------------------------------
  const growthPoints = [1, 10, 50, 100, 250, 500, 1000]
  const growthResults = []

  for (const n of growthPoints) {
    const chat = hub.createChat(tmp)
    for (let i = 0; i < n; i++) {
      const f = await files.importFile(`doc-${i}.txt`, new TextEncoder().encode(`Document ${i}: standard payload content.`))
      await turn(chat.id, 'claude', `t${i}`, [f])
    }
    const r = await turn(chat.id, 'antigravity', 'measure')
    const atts = r.request.attachments ?? []
    const base = analyzeManifest(attachmentInput('', atts, false).text)

    // Naive K=15
    const naive15 = analyzeManifest(attachmentInput('', atts.slice(0, 15), false).text)

    // Reference Prototype Catalog
    const catalogPath = join(tmp, `catalog-${n}.json`)
    const prototype = buildBoundedCatalogManifest(atts, catalogPath, 15)

    growthResults.push({
      n,
      baselineManifestChars: base.manifestChars,
      baselineManifestEntries: base.manifestEntries,
      naive15ManifestChars: naive15.manifestChars,
      naive15ManifestEntries: naive15.manifestEntries,
      prototypePromptChars: prototype.totalPromptChars,
      prototypeCatalogChars: prototype.catalogChars,
      catalogFileSizeOnDisk: existsSync(catalogPath) ? readFileSync(catalogPath).length : 0
    })
  }
  results.exp2_scaling = growthResults

  // --------------------------------------------------------------------------
  // EXPERIMENT 3: Prototype Retrieval Verification (Content, File, PDF)
  // --------------------------------------------------------------------------
  // Test retrieval using the Bounded Catalog Prototype on the N=249 chat
  const catalogPath250 = join(tmp, 'catalog-chat1.json')
  const proto250 = buildBoundedCatalogManifest(probe.request.attachments ?? [], catalogPath250, 15)

  // Verify catalog file contents
  const catalogData: CatalogEntry[] = JSON.parse(readFileSync(catalogPath250, 'utf8'))

  // 3.1 Content search in catalog (e.g. grep/filter)
  const foundMidByKeyword = catalogData.filter(e => e.keywords.includes('ZEUS_SECRET_789') || e.snippet.includes('ZEUS_SECRET_789'))
  const foundAncientByKeyword = catalogData.filter(e => e.keywords.includes('APOLLO_BUDGET_123') || e.snippet.includes('APOLLO_BUDGET_123'))
  const foundPdfInCatalog = catalogData.filter(e => e.name === 'spec-ancient.pdf')

  results.exp3_prototypeRetrieval = {
    catalogPath: catalogPath250,
    promptManifestChars: proto250.totalPromptChars,
    catalogEntriesCount: catalogData.length,
    contentRetrievalMid: {
      found: foundMidByKeyword.length === 1,
      matchedId: foundMidByKeyword[0]?.id,
      matchedName: foundMidByKeyword[0]?.name,
      path: foundMidByKeyword[0]?.path
    },
    contentRetrievalAncient: {
      found: foundAncientByKeyword.length === 1,
      matchedId: foundAncientByKeyword[0]?.id,
      matchedName: foundAncientByKeyword[0]?.name,
      path: foundAncientByKeyword[0]?.path
    },
    pdfRetrieval: {
      found: foundPdfInCatalog.length === 1,
      path: foundPdfInCatalog[0]?.path,
      textPath: foundPdfInCatalog[0]?.textPath,
      hasExtractedTextDirectly: Boolean(foundPdfInCatalog[0]?.textPath && existsSync(foundPdfInCatalog[0]!.textPath))
    }
  }

  // --------------------------------------------------------------------------
  // EXPERIMENT 4: Session Lost Replay with Prototype vs Baseline
  // --------------------------------------------------------------------------
  adapters.codex.ran = []
  const chatLost = hub.createChat(tmp)
  for (let i = 0; i < 30; i++) {
    const f = await files.importFile(`file-${i}.txt`, new TextEncoder().encode(`Turn ${i} notes`))
    await turn(chatLost.id, 'claude', `t${i}`, [f])
  }
  
  adapters.codex.loseNext = true
  const beforeCount = adapters.codex.ran.length
  const lostTurn = await turn(chatLost.id, 'codex', 'hello')
  const [lostReq, retryReq] = adapters.codex.ran.slice(beforeCount)

  results.exp4_sessionLost = {
    initialAttemptAttachments: lostReq?.attachments?.length ?? 0,
    retryAttemptAttachments: retryReq?.attachments?.length ?? 0,
    retryHandoffTurns: retryReq?.handoff?.turns ?? 0,
    status: lostTurn.done.status
  }

  writeFileSync(join(here, 'experiment-retrieval.json'), JSON.stringify(results, null, 2) + '\n')
  console.log('Experiment completed successfully. Output written to experiment-retrieval.json')
} finally {
  store.close()
  rmSync(tmp, { recursive: true, force: true })
}
