import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '../../tests/ui/app.ts'
import type { Orchestration } from '../../src/shared/orchestrator.ts'

// Task-0006 evidence: the board's round-3 refinements in an isolated profile with controlled
// providers only. 1440x960 alone, then 1360x860 with the browser open (the rail and its overlay).

test('board 0006: strips, queue notes, expanded nav, queued reply, rail beside the browser', async ({ rocket }) => {
  const { page, profile, app } = rocket
  const size = (width: number, height: number) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [width, height] as const)
  await size(1440, 960)
  await expect(page.locator('.orch-shell')).toBeVisible()

  await page.locator('.composer-folder').first().click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).first().fill('Continuously exercise the worker board.\nUI check: orchestra-shell')
  await page.getByRole('button', { name: 'Send', exact: true }).first().click()
  await expect.poll(async () => readFile(join(profile, 'ui-orchestra.json'), 'utf8').then(() => true).catch(() => false), { timeout: 30_000 }).toBe(true)
  const fixture = JSON.parse(await readFile(join(profile, 'ui-orchestra.json'), 'utf8')) as { chatId: string }
  const channel = JSON.parse(await readFile(join(profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
  const raw = async (args: Record<string, unknown>) => {
    const response = await fetch(`http://127.0.0.1:${channel.port}/mcp/${channel.secret}/codex/${fixture.chatId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orchestrator', arguments: args } })
    })
    return (await response.json()).result as { isError?: boolean; content: Array<{ text: string }> }
  }
  const status = async (): Promise<Orchestration> => JSON.parse((await raw({ action: 'status' })).content[0]!.text)
  const windowOf = (chatId: string) => page.locator(`[data-testid="worker-window"][data-chat-id="${chatId}"]`)
  const run = await status()
  const running = run.tasks.filter(task => task.status === 'running')
  const queued = run.tasks.filter(task => task.status === 'queued')
  await expect(page.getByTestId('worker-window')).toHaveCount(run.tasks.length)

  // Compact windows: one Assignment line, no injected message, no duplicate "Working for" head.
  for (const task of running) {
    const worker = windowOf(task.chatId)
    await expect(worker).toContainText(`Streaming from ${task.provider}.`)
    await expect(worker.locator('.assignment-strip')).toHaveCount(1)
    await expect(worker.locator('.assignment-strip')).toHaveAttribute('title', task.task)
    await expect(worker).not.toContainText('<rocket-orchestration>')
    await expect(worker).not.toContainText('You are one worker')
    await expect(worker.locator('.turn-head')).toHaveCount(0)
  }
  for (const task of queued) {
    await expect(windowOf(task.chatId)).toContainText(/Waiting for a free (Claude|Codex|Cursor|Antigravity) slot · #1 in queue/)
    await expect(windowOf(task.chatId).getByRole('button', { name: 'Stop worker', exact: true })).toBeEnabled()
  }
  await windowOf(running[0]!.chatId).hover()
  await rocket.capture('01-1440-six-workers-hover')

  // Expanded: the assignment folds behind a toggle; arrows and buttons move between workers.
  await windowOf(running[0]!.chatId).getByRole('button', { name: 'Expand worker', exact: true }).click()
  const expanded = page.getByTestId('worker-expanded')
  await expect(expanded).toHaveAttribute('data-chat-id', running[0]!.chatId)
  await expect(expanded.getByRole('button', { name: 'Show assignment' })).toBeVisible()
  await expect(expanded).not.toContainText('You are one worker')
  await expect(expanded.locator('.turn-head')).toHaveCount(1)
  await rocket.capture('02-1440-expanded-assignment-folded')
  await expanded.getByRole('button', { name: 'Show assignment' }).click()
  await expect(expanded).toContainText('You are one worker')
  await rocket.capture('03-1440-expanded-assignment-open')
  const order = await page.evaluate(() => window.rocketMap.where().board?.workers.map(worker => worker.chatId))
  // The reply box has the focus and is empty, so the arrows still move between workers.
  await expanded.getByRole('textbox', { name: 'Message', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(expanded).not.toHaveAttribute('data-chat-id', running[0]!.chatId)
  const afterRight = await expanded.getAttribute('data-chat-id')
  await expanded.getByRole('button', { name: 'Previous worker', exact: true }).click()
  await expect(expanded).toHaveAttribute('data-chat-id', running[0]!.chatId)
  const next = await page.evaluate(() => window.rocketMap.act('worker.next', {}))
  expect(next.ok).toBe(true)
  expect(next.where.board?.expanded).toBe(afterRight)
  await writeFile(join(profile, '..', 'nav.json'), JSON.stringify({ order, start: running[0]!.chatId, afterRight, mapNext: next.where.board?.expanded }, null, 2))

  // A queued worker expanded: its reply box waits.
  await page.evaluate(chatId => window.rocketMap.act('worker.expand', { chatId }), queued[0]!.chatId)
  await expect(expanded).toHaveAttribute('data-status', 'queued')
  const reply = expanded.getByRole('textbox', { name: 'Message', exact: true })
  await expect(reply).toBeDisabled()
  await expect(reply).toHaveAttribute('placeholder', 'Waiting in the queue — starts when a slot frees')
  await rocket.capture('04-1440-expanded-queued')
  await page.keyboard.press('Escape')
  await expect(expanded).toHaveCount(0)

  // 1360x860 with the browser open: the board folds to its rail; opening it covers the shell only.
  await size(1360, 860)
  await page.evaluate(() => window.rocketMap.go('browser', {}))
  await expect(page.locator('.browser')).toBeVisible()
  const rail = page.getByTestId('worker-rail')
  await expect(rail).toBeVisible()
  const stage = async () => app.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows()[0].contentView.children
    .filter(view => view instanceof WebContentsView && view.getVisible()).map(view => view.getBounds()))
  const leader = await page.getByTestId('orchestrator-chat').boundingBox()
  const browserBox = await page.locator('.browser').boundingBox()
  const before = await stage()
  await rocket.capture('05-1360-browser-rail')
  await rail.click()
  const overlay = page.locator('.orch-board-side.is-overlay')
  await expect(overlay).toBeVisible()
  await expect(page.getByTestId('worker-window')).toHaveCount(run.tasks.length)
  const box = await overlay.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(browserBox!.x)
  expect(await stage()).toEqual(before)
  await rocket.capture('06-1360-browser-rail-open')
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
  await writeFile(join(profile, '..', 'layout-1360-browser.json'), JSON.stringify({ leader, browserBox, overlay: box, nativeViews: before }, null, 2))

  // 1440x960 with the browser open: wide enough for a single-column board.
  await size(1440, 960)
  await expect.poll(async () => page.locator('.orch-shell.is-rail').count()).toBeGreaterThanOrEqual(0)
  await rocket.capture('07-1440-browser')
  const wide = { rail: await page.locator('.orch-shell.is-rail').count(), leader: await page.getByTestId('orchestrator-chat').boundingBox(), board: await page.getByTestId('worker-board').boundingBox().catch(() => null) }
  await writeFile(join(profile, '..', 'layout-1440-browser.json'), JSON.stringify(wide, null, 2))
  await raw({ action: 'stop', drain: false })

  const journal = (await readFile(join(profile, 'journal.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  expect(journal.filter(entry => entry.kind === 'crash')).toEqual([])
})
