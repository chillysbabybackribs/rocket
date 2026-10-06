import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test, expect } from './app'
import { seedLongChat, type LongChat } from '../fixtures/long-chat'

// The window's half of the long-chat benchmark: chats of real and larger sizes are written into
// the isolated profile, and the app opens each from the history, switches back to it from
// another tab and scrolls it to the top. Times are taken inside the page, from the click to the
// second frame after every turn is in the DOM, with the longest main-thread task in each phase.
// Run alone with `npm run check:ui -- long-chat`; results are attached and saved under
// .artifacts/bench/. The host's half is src/host/transcript-bench.ts.

const SIZES = (process.env.LONG_CHAT_TURNS ?? '45,250,1000').split(',').map(Number)

type Phase = { ms: number; longestTaskMs: number }
type Profile = { nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>; samples?: number[]; timeDeltas?: number[] }

/** Save the profile beside the results and print the functions that took the most time themselves. */
async function saveProfile({ profile }: { profile: Profile }): Promise<void> {
  const out = resolve('.artifacts/bench')
  await mkdir(out, { recursive: true })
  await writeFile(join(out, `transcript-open-${Date.now()}.cpuprofile`), JSON.stringify(profile))
  const self = new Map<string, number>()
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const deltas = profile.timeDeltas ?? []
  ;(profile.samples ?? []).forEach((id, index) => {
    const { functionName, url, lineNumber } = byId.get(id)!.callFrame
    // Frames with no script are the test's own injected queries, idle time and the engine; only
    // the collector among them is the app's cost.
    if (!url && functionName !== '(garbage collector)') return
    const key = `${functionName || '(anonymous)'} ${url.split('/').pop()}:${lineNumber}`
    self.set(key, (self.get(key) ?? 0) + (deltas[index] ?? 0) / 1000)
  })
  console.table([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([fn, ms]) => ({ fn, ms: Math.round(ms) })))
}

test('long chats open, switch and scroll within budget', async ({ rocket }) => {
  test.setTimeout(600_000)
  const db = join(rocket.profile, 'rocket.db')
  const small = seedLongChat(db, { turns: 2, cwd: rocket.workspace, title: 'Short chat', seed: 7 })
  const chats: LongChat[] = SIZES.map((turns, index) => seedLongChat(db, { turns, cwd: rocket.workspace, seed: index + 1 }))
  await rocket.restart()
  const { page } = rocket
  await page.evaluate(() => {
    const w = window as unknown as { tasks: number[][] }
    w.tasks = []
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) w.tasks.push([entry.startTime, entry.duration]) })
      .observe({ type: 'longtask', buffered: true })
  })

  // Click `target` inside the page and resolve two frames after the first pane shows `turns` turns.
  const measure = (target: { selector: string; text: string } | 'scrollTop', turns: number): Promise<Phase> => page.evaluate(async ({ target, turns }) => {
    const w = window as unknown as { tasks: number[][] }
    const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()))
    const pane = (): Element => document.querySelector('.pane')!
    const start = performance.now()
    if (target === 'scrollTop') {
      pane().querySelector('.transcript')!.scrollTop = 0
    } else {
      const element = [...document.querySelectorAll(target.selector)].find((candidate) => candidate.textContent?.includes(target.text))
      if (!element) throw new Error(`Nothing matches ${target.selector} with "${target.text}".`)
      ;(element as HTMLElement).click()
    }
    while (pane().querySelectorAll('.turn').length !== turns || !pane().querySelector('.turn:last-of-type .prose')) {
      if (performance.now() - start > 120_000) throw new Error(`The chat did not show ${turns} turns within two minutes.`)
      await frame()
    }
    await frame()
    await frame()
    const end = performance.now()
    const longest = w.tasks.filter(([at, duration]) => at + duration >= start && at <= end).reduce((max, [, duration]) => Math.max(max, duration), 0)
    return { ms: Math.round(end - start), longestTaskMs: Math.round(longest) }
  }, { target, turns })

  const openFromHistory = async (title: string, turns: number): Promise<Phase> => {
    await page.getByRole('button', { name: 'Chat history', exact: true }).click()
    await expect(page.getByRole('menu', { name: 'Chat history' })).toBeVisible()
    return await measure({ selector: '[role="menuitem"]', text: title }, turns)
  }

  await openFromHistory('Short chat', small.turns)
  const rows: Array<Record<string, number>> = []
  for (const chat of chats) {
    const title = `Long chat (${chat.turns} turns)`
    // LONG_CHAT_PROFILE=1 records where the largest open spends its time, by function.
    const profiling = process.env.LONG_CHAT_PROFILE === '1' && chat === chats.at(-1)
    const cdp = profiling ? await page.context().newCDPSession(page) : null
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start') }
    const open = await openFromHistory(title, chat.turns)
    if (cdp) await saveProfile(await cdp.send('Profiler.stop'))
    const stats = await page.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      heapMB: Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6)
    }))
    const scroll = await measure('scrollTop', chat.turns)
    await page.getByRole('tab').filter({ hasText: 'Short chat' }).click()
    await expect(page.locator('.pane').first().locator('.turn')).toHaveCount(small.turns)
    const back = await measure({ selector: '[role="tab"]', text: title }, chat.turns)
    rows.push({
      turns: chat.turns,
      items: chat.items,
      'open ms': open.ms,
      'open longest task ms': open.longestTaskMs,
      'switch back ms': back.ms,
      'switch longest task ms': back.longestTaskMs,
      'scroll to top ms': scroll.ms,
      'DOM nodes': stats.nodes,
      'JS heap MB (approx.)': stats.heapMB
    })
    await expect(page.locator('.pane').first().locator('.turn').last()).toContainText(`Reply ${chat.turns}.`)
  }

  console.table(rows)
  const body = JSON.stringify(rows, null, 2)
  await test.info().attach('Long chat timings', { body, contentType: 'application/json' })
  const out = resolve('.artifacts/bench')
  await mkdir(out, { recursive: true })
  await writeFile(join(out, `transcript-ui-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), body)
})
