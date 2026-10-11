// What grows with N historical attachments when a provider receives a handoff.
// Real Store (temp SQLite), real AttachmentStore (temp folder, real fixture bytes), real Hub,
// real attachmentInput/withHandoff. Adapters are recorders that complete at once: no model runs.
// Run: node --experimental-transform-types --disable-warning=ExperimentalWarning \
//   docs/research/continuous/orchestrated/evidence-04-antigravity/experiment-attachments.ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../../../../src/host/store.ts'
import { AttachmentStore } from '../../../../../src/host/attachments.ts'
import { Hub } from '../../../../../src/host/hub.ts'
import { attachmentInput } from '../../../../../src/host/providers/images.ts'
import { withHandoff } from '../../../../../src/host/handoff.ts'
import { unavailableUsage, type RunRequest, type RunResult, type TurnSink } from '../../../../../src/host/providers/provider.ts'
import type { Attachment, ProviderId } from '../../../../../src/shared/types.ts'

const here = new URL('.', import.meta.url).pathname
const tmp = mkdtempSync(join(tmpdir(), 'rocket-ag04-'))
const fixtures = join(tmp, 'fixtures')
execFileSync('python3', [join(here, 'make-fixtures.py'), fixtures])
const bytes = (name: string) => new Uint8Array(readFileSync(join(fixtures, name)))

class Recorder {
  ran: RunRequest[] = []
  loseNext = false
  constructor(readonly id: ProviderId) {}
  async run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
    this.ran.push(request)
    if (this.loseNext) { this.loseNext = false; return { status: 'failed', sessionLost: true } }
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
const adapters = { claude: new Recorder('claude'), codex: new Recorder('codex'), cursor: new Recorder('cursor'), antigravity: new Recorder('antigravity') }
const hub = new Hub(store, adapters as never, () => {}, () => {}, null, ids => files.resolve(ids))

async function turn(chatId: string, provider: ProviderId, text: string, attachments: Attachment[] = []) {
  const turnId = hub.send(chatId, provider, null, text, null, attachments)
  const done = await hub.waitForTurn(chatId, { turnId, timeoutMs: 10_000 })
  return { done, request: adapters[provider].ran.at(-1)! }
}

const BODY = (i: number) => { const head = `note ${i}\n`; return head + 'x'.repeat(10_000 - head.length) }   // exactly 10,000 characters
let serial = 0
const textFile = (i: number, name = `note-${i}.txt`) => files.importFile(name, new TextEncoder().encode(BODY(i) + '\n'))
const smallImage = () => files.import(`shot-${++serial}.png`, bytes('small.png'), bytes('thumb.jpg'))
const bigImage = () => files.import(`big-${++serial}.png`, bytes('big.png'), bytes('thumb.jpg'))

/** The attachment part only (empty message text), measured the way each adapter builds it. */
function measure(request: RunRequest, pixels: boolean) {
  const input = attachmentInput('', request.attachments ?? [], pixels)
  const manifest = input.text.split('\n\n<file ')[0]!
  const lines = manifest ? manifest.split('\n') : []
  return {
    attachments: request.attachments?.length ?? 0,
    attachmentTextChars: input.text.length,
    manifestChars: manifest.length,
    manifestLines: lines.length,
    manifestCharsPerLine: lines.length ? Math.round(manifest.length / lines.length) : 0,
    bodies: (input.text.match(/\n<file name=/g) ?? []).length + (input.text.startsWith('<file name=') ? 1 : 0),
    bodyChars: input.text.length - manifest.length,
    truncatedBodies: (input.text.match(/\[Truncated at /g) ?? []).length,
    readIfNeeded: lines.filter(line => line.endsWith('read this file if needed]')).length,
    missingMarkers: lines.filter(line => line.includes('stored copy is missing')).length,
    noTextMarkers: lines.filter(line => line.includes('no text could be extracted')).length,
    images: input.images.length,
    imageBytes: input.images.reduce((sum, image) => sum + image.size, 0)
  }
}
const handoffShape = (request: RunRequest) => ({
  handoffTurns: request.handoff?.turns ?? 0,
  handoffTextChars: request.handoff?.text.length ?? 0,
  handoffSaysLeftOut: Number(/The (\d+) turns before these are left out/.exec(request.handoff?.text ?? '')?.[1] ?? 0),
  handoffAttachments: request.handoff?.attachments?.length ?? 0,
  codexInjectedChars: request.handoff?.messages.reduce((sum, message) => sum + message.text.length, 0) ?? 0
})

const result: Record<string, unknown> = { note: 'Each history file holds 10,000 characters. Pixel figures apply to Claude/Cursor/Codex (includePixels=true); Antigravity passes includePixels=false (antigravity.ts:201).' }

try {
  // A. N text files, one per Claude turn; then Codex (missed all N) and a second Codex turn.
  const growth = []
  for (const n of [1, 5, 12, 13, 50, 200, 1000]) {
    const chat = hub.createChat(tmp)
    for (let i = 0; i < n; i++) await turn(chat.id, 'claude', `turn ${i}`, [await textFile(i)])
    const first = await turn(chat.id, 'codex', 'summarize the notes')
    const again = await turn(chat.id, 'codex', 'and again')
    const ag = await turn(chat.id, 'antigravity', 'your view?')
    growth.push({
      n,
      codexFirst: { ...handoffShape(first.request), ...measure(first.request, true) },
      codexSameProviderNext: { ...handoffShape(again.request), attachments: again.request.attachments?.length ?? 0 },
      antigravityFirst: {
        ...handoffShape(ag.request), ...measure(ag.request, false),
        fullMessageChars: attachmentInput(withHandoff(ag.request.handoff, ag.request.text), ag.request.attachments, false).text.length
      }
    })
  }
  result.A_textFileGrowth = growth

  // A2. Manifest line length with the longest name cleanName keeps (180 characters).
  {
    const chat = hub.createChat(tmp)
    await turn(chat.id, 'claude', 'long name', [await textFile(0, 'n'.repeat(176) + '.txt')])
    const r = await turn(chat.id, 'codex', 'go')
    result.A2_longNameManifestLine = measure(r.request, true).manifestChars
  }

  // B. N small images; C. six ~4.4 MB images.
  const images = []
  for (const n of [5, 10, 11, 40]) {
    const chat = hub.createChat(tmp)
    for (let i = 0; i < n; i++) await turn(chat.id, 'claude', `image ${i}`, [await smallImage()])
    const codex = await turn(chat.id, 'codex', 'compare')
    const ag = await turn(chat.id, 'antigravity', 'compare')
    images.push({ n, codex: measure(codex.request, true), antigravity: measure(ag.request, false) })
  }
  result.B_smallImages = images
  {
    const chat = hub.createChat(tmp)
    for (let i = 0; i < 6; i++) await turn(chat.id, 'claude', `big ${i}`, [await bigImage()])
    const codex = await turn(chat.id, 'codex', 'compare')
    result.C_bigImages = { n: 6, eachBytes: readFileSync(join(fixtures, 'big.png')).length, codex: measure(codex.request, true) }
  }

  // D. Alternating providers, one file per message: what each turn re-sends.
  {
    const chat = hub.createChat(tmp)
    const seq = []
    for (let i = 0; i < 8; i++) {
      const provider: ProviderId = i % 2 ? 'codex' : 'claude'
      const r = await turn(chat.id, provider, `alt ${i}`, [await textFile(i)])
      seq.push({ i, provider, handoffTurns: r.request.handoff?.turns ?? 0, attachments: r.request.attachments?.length ?? 0, bodies: measure(r.request, true).bodies })
    }
    result.D_alternating = seq
  }

  // E. PDFs (text layer and image-only) in history.
  {
    const chat = hub.createChat(tmp)
    const pdf = await files.importFile('text.pdf', bytes('text.pdf'))
    const scanned = await files.importFile('scanned.pdf', bytes('scanned.pdf'))
    await turn(chat.id, 'claude', 'pdfs', [pdf, scanned])
    const r = await turn(chat.id, 'antigravity', 'read them')
    result.E_pdfs = { pdfChars: pdf.chars, scannedChars: scanned.chars, antigravity: measure(r.request, false) }
  }

  // F. A historical file whose stored copy was deleted from disk.
  {
    const chat = hub.createChat(tmp)
    const a = await textFile(1), b = await textFile(2)
    await turn(chat.id, 'claude', 'one', [a])
    await turn(chat.id, 'claude', 'two', [b])
    unlinkSync(files.resolve([a.id])[0]!.path)
    const r = await turn(chat.id, 'codex', 'go')
    result.F_missingStoredCopy = { status: r.done.status, ...measure(r.request, true) }
  }

  // G. A historical attachment whose database row is gone (not reachable through collect() for a
  // live chat: unusedAttachments keeps every id a user item names; this tests robustness only).
  {
    const chat = hub.createChat(tmp)
    const a = await textFile(1)
    await turn(chat.id, 'claude', 'one', [a])
    store.deleteAttachment(a.id)
    const ranBefore = adapters.codex.ran.length
    const first = hub.send(chat.id, 'codex', null, 'go', null, [])
    const t1 = await hub.waitForTurn(chat.id, { turnId: first, timeoutMs: 10_000 })
    const second = hub.send(chat.id, 'codex', null, 'go again', null, [])
    const t2 = await hub.waitForTurn(chat.id, { turnId: second, timeoutMs: 10_000 })
    const claude = await turn(chat.id, 'claude', 'still fine?')
    result.G_missingRow = {
      codexFirst: { status: t1.status, error: t1.error }, codexSecond: { status: t2.status, error: t2.error },
      codexAdapterCalls: adapters.codex.ran.length - ranBefore, claudeAfter: claude.done.status
    }
  }

  // H. Session lost: the retry hands over the whole chat, with every attachment in it.
  {
    const chat = hub.createChat(tmp)
    for (let i = 0; i < 20; i++) await turn(chat.id, 'claude', `turn ${i}`, [await textFile(i)])
    await turn(chat.id, 'codex', 'catch up')
    await turn(chat.id, 'claude', 'one more', [await textFile(20)])
    adapters.codex.loseNext = true
    const before = adapters.codex.ran.length
    const r = await turn(chat.id, 'codex', 'after loss')
    const [lost, retry] = adapters.codex.ran.slice(before)
    result.H_sessionLost = { status: r.done.status, firstAttempt: measure(lost!, true).attachments, retry: { ...handoffShape(retry!), ...measure(retry!, true) } }
  }

  // I. Antigravity refuses a current image but receives history images as paths only.
  {
    const chat = hub.createChat(tmp)
    let refused = ''
    try { hub.send(chat.id, 'antigravity', null, 'see', null, [await smallImage()]) } catch (error) { refused = (error as Error).message }
    result.I_antigravityCurrentImage = refused
  }

  writeFileSync(join(here, 'experiment-attachments.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  store.close()
  rmSync(tmp, { recursive: true, force: true })
}
