import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '/home/dp/Desktop/rocket-orchestrator/tests/ui/app.ts'
import type { Orchestration } from '/home/dp/Desktop/rocket-orchestrator/src/shared/orchestrator.ts'

// Task-0001 evidence: drives the worker board in an isolated profile with controlled providers
// only, and captures each state. It tolerates the host's dispatch rules (reject or queue), since
// those are being changed by another worker; it asserts the UI contract, not the host limits.

test('board capture: empty, streaming, done, report, expand+reply, stop, filters, map, many workers', async ({ rocket }) => {
  const { page, profile } = rocket
  await expect(page.locator('.orch-shell')).toBeVisible()
  await expect(page.getByTestId('worker-board-empty')).toBeVisible()
  await rocket.capture('01-empty-board')

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
  const releaseTurn = (turnId: string) => writeFile(join(profile, `ui-release-${turnId}`), '')
  const review = (taskId: string) => raw({ action: 'checkpoint', taskId, summary: 'Board capture.', next: 'Continue.', review: 'Controlled fixture only.' })

  const windows = page.getByTestId('worker-window')
  const windowOf = (chatId: string) => page.locator(`[data-testid="worker-window"][data-chat-id="${chatId}"]`)
  let run = await status()
  const running = run.tasks.filter(task => task.status === 'running')
  expect(running.length).toBeGreaterThanOrEqual(2)
  await expect(windows).toHaveCount(run.tasks.length)
  for (const task of running) {
    await expect(windowOf(task.chatId)).toHaveAttribute('data-status', 'running')
    await expect(windowOf(task.chatId)).toContainText(`Streaming from ${task.provider}.`)
  }
  await rocket.capture('02-workers-streaming')

  // One finishes: done, its report opens in the artifact panel.
  const first = running[0]!
  await releaseTurn(first.turnId!)
  await expect(windowOf(first.chatId)).toHaveAttribute('data-status', 'done')
  await expect(windowOf(first.chatId)).toContainText('Complete.')
  await review(first.id)
  await windowOf(first.chatId).getByRole('button', { name: 'Open report', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Artifact preview' })).toContainText('Controlled worker report')
  await rocket.capture('03-report-artifact')
  await page.getByRole('button', { name: 'Close artifact', exact: true }).click()

  // Expand it and reply; the reply is a new turn in the worker's own chat.
  await windowOf(first.chatId).getByRole('button', { name: 'Expand worker', exact: true }).click()
  const expanded = page.getByTestId('worker-expanded')
  await expect(expanded).toBeVisible()
  await expect(expanded).toHaveAttribute('data-chat-id', first.chatId)
  await expanded.getByRole('textbox', { name: 'Message', exact: true }).fill('Reply observed in worker transcript\nUI check: good evening')
  await expanded.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(expanded).toContainText('Reply observed in worker transcript')
  await rocket.capture('04-worker-expanded-reply')
  const replyTurn = JSON.parse(await readFile(join(profile, 'ui-request.json'), 'utf8')).turnId as string
  await releaseTurn(replyTurn)
  await expanded.getByRole('button', { name: 'Close expanded worker', exact: true }).click()
  await expect(expanded).toHaveCount(0)

  // Stop one worker from its window.
  const second = running[1]!
  await windowOf(second.chatId).getByRole('button', { name: 'Stop worker', exact: true }).click()
  await expect(windowOf(second.chatId)).toHaveAttribute('data-status', 'cancelled')
  await review(second.id)
  await rocket.capture('05-worker-stopped')

  // Settle the rest, then dispatch until the board holds eight or more workers.
  for (let round = 0; round < 30 && (await windows.count()) < 8; round++) {
    run = await status()
    for (const task of run.tasks) {
      if (task.status === 'running' && task.turnId) await releaseTurn(task.turnId)
    }
    await expect.poll(async () => (await status()).tasks.filter(task => task.status === 'running').length, { timeout: 20_000 }).toBe(0)
    for (const task of (await status()).tasks) if (task.review === null && task.status !== 'queued') await review(task.id)
    await raw({ action: 'dispatch', provider: ['claude', 'codex', 'cursor'][round % 3], task: `Board capture worker ${round + 1}` })
  }
  await expect.poll(() => windows.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(8)
  const board = page.getByTestId('worker-board')
  const sizes = await board.evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight }))
  expect(sizes.scroll).toBeGreaterThan(sizes.client)
  await rocket.capture('06-many-workers-top')
  await board.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(windows.last()).toBeInViewport()
  await rocket.capture('07-many-workers-scrolled')

  // Filters and the app map's worker actions.
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect.poll(async () => page.locator('[data-testid="worker-window"][data-status="running"]').count()).toBe(0)
  await rocket.capture('08-filter-done')
  await page.getByRole('button', { name: 'All', exact: true }).click()
  const target = (await status()).tasks.at(-1)!
  const result = await page.evaluate(chatId => window.rocketMap.act('worker.expand', { chatId }), target.chatId)
  expect(result.ok).toBe(true)
  expect(result.where.board?.expanded).toBe(target.chatId)
  await expect(page.getByTestId('worker-expanded')).toHaveAttribute('data-chat-id', target.chatId)
  await rocket.capture('09-map-expand')
  const collapsed = await page.evaluate(() => window.rocketMap.act('worker.collapse', {}))
  expect(collapsed.ok).toBe(true)
  await expect(page.getByTestId('worker-expanded')).toHaveCount(0)
  await writeFile(join(profile, '..', 'where.json'), JSON.stringify(collapsed.where, null, 2))
  await raw({ action: 'stop', drain: false })
})
