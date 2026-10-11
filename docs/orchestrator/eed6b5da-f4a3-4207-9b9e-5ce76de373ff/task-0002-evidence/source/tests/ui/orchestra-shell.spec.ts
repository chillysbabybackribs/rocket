import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { test, expect } from './app'
import type { Orchestration, OrchestratorTask } from '../../src/shared/orchestrator'

// The fixture launches a fresh marked profile, real host/store and controlled providers only.
// Host dispatch rejects overflow rather than queueing: eight windows accumulate over reviews.
test('orchestra-shell fresh profile keeps the leader full height below the title strip', async ({ rocket }) => {
  const { page } = rocket
  await rocket.capture('01-fresh-profile')
  await expect(page.locator('.orch-shell')).toBeVisible()
  const leader = page.getByTestId('orchestrator-chat')
  await expect(leader).toBeVisible()
  await expect(page.getByTestId('worker-board-empty')).toBeVisible()
  const shell = await page.locator('.orch-shell').boundingBox()
  const column = await leader.boundingBox()
  expect(shell).not.toBeNull()
  expect(column).not.toBeNull()
  const title = await page.locator('.titlebar').boundingBox()
  expect(title).not.toBeNull()
  expect(Math.abs(shell!.y - title!.y - title!.height)).toBeLessThanOrEqual(2)
  expect(Math.abs(column!.y - shell!.y)).toBeLessThanOrEqual(2)
  expect(Math.abs(column!.height - shell!.height)).toBeLessThanOrEqual(2)
  expect(Math.abs(shell!.y + shell!.height - await page.evaluate(() => innerHeight))).toBeLessThanOrEqual(2)
})

async function start(rocket: { page: Page; profile: string }) {
  const { page, profile } = rocket
  await page.locator('.composer-folder').first().click()
  const composer = page.getByRole('textbox', { name: 'Message', exact: true }).first()
  await composer.fill('Continuously exercise the isolated worker board.\nUI check: orchestra-shell')
  await page.getByRole('button', { name: 'Send', exact: true }).first().click()
  await expect.poll(async () => readFile(join(profile, 'ui-orchestra.json'), 'utf8').then(() => true).catch(() => false)).toBe(true)
  const fixture = JSON.parse(await readFile(join(profile, 'ui-orchestra.json'), 'utf8')) as {
    chatId: string; turnId: string; results: Array<{ isError?: boolean; content: Array<{ text: string }> }>
  }
  const channel = JSON.parse(await readFile(join(profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
  const callRaw = async (args: Record<string, unknown>) => {
    const response = await fetch(`http://127.0.0.1:${channel.port}/mcp/${channel.secret}/codex/${fixture.chatId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orchestrator', arguments: args } })
    })
    expect(response.ok).toBe(true)
    const body = await response.json()
    expect(body.error).toBeUndefined()
    return body.result as { isError?: boolean; content: Array<{ text: string }> }
  }
  const call = async (args: Record<string, unknown>): Promise<Orchestration> => {
    const result = await callRaw(args)
    expect(result.isError, JSON.stringify(result)).toBeUndefined()
    return JSON.parse(result.content[0].text)
  }
  const release = async (task: OrchestratorTask) => {
    expect(task.turnId).toBeTruthy()
    await writeFile(join(profile, `ui-release-${task.turnId}`), '')
    await expect.poll(async () => (await call({ action: 'status' })).tasks.find(each => each.id === task.id)?.status).toBe('completed')
  }
  const review = async (task: OrchestratorTask) => call({ action: 'checkpoint', taskId: task.id,
    summary: 'Controlled fixture inspected.', next: 'Continue isolated board checks.',
    review: 'Accepted fixture report and observed stream; external provider behavior is outside this check.' })
  expect(fixture.results).toHaveLength(5)
  expect(fixture.results.slice(0, 4).every(result => !result.isError)).toBe(true)
  expect(fixture.results[4].isError).toBe(true)
  expect(fixture.results[4].content[0].text).toContain('Three workers are already running')
  return { fixture, call, callRaw, release, review }
}

test('orchestra-shell controlled dispatch and report harness exercises actual host limits', async ({ rocket }, info) => {
  const { fixture, call, callRaw, release, review } = await start(rocket)
  await info.attach('Controlled tool results', { body: JSON.stringify(fixture, null, 2), contentType: 'application/json' })
  const run = await call({ action: 'status' })
  expect(run.tasks).toHaveLength(3)
  expect(run.tasks.every(task => task.status === 'running')).toBe(true)
  expect(new Set(run.tasks.map(task => task.provider)).size).toBe(3)
  await rocket.capture('02-controlled-dispatch-limit')
  const task = run.tasks[0]
  await release(task)
  expect(await readFile(task.report, 'utf8')).toContain('Controlled worker report')
  const blocked = await callRaw({ action: 'dispatch', provider: 'claude', task: 'UI shell worker blocked before review' })
  expect(blocked.isError).toBe(true)
  expect(blocked.content[0].text).toContain('Review the finished worker evidence')
  await rocket.capture('03-controlled-report-delivered')
  await review(task)
  for (const other of run.tasks.slice(1)) {
    await release(other)
    await review(other)
  }
  for (let index = 4; index <= 8; index++) {
    const state = await call({ action: 'dispatch', provider: 'claude', task: `UI shell worker ${index}` })
    expect((state as Orchestration & { totalTasks: number }).totalTasks).toBe(index)
    const worker = state.tasks.find(each => each.task === `UI shell worker ${index}`)!
    await release(worker)
    expect(await readFile(worker.report, 'utf8')).toContain('Controlled worker report')
    await review(worker)
  }
  await info.attach('Eight-worker host state', { body: await readFile(join(rocket.profile, 'orchestrator.json'), 'utf8'), contentType: 'application/json' })
  await rocket.capture('03b-eight-controlled-reports')
  await call({ action: 'stop', drain: false })
})

test('orchestra-shell streams eight workers and supports expand reply stop reports and scrolling', async ({ rocket }, info) => {
  const { page } = rocket
  const { fixture, call, release, review } = await start(rocket)
  await info.attach('Controlled tool results', { body: JSON.stringify(fixture, null, 2), contentType: 'application/json' })
  await rocket.capture('04-workers-dispatched')
  await expect(page.locator('.orch-shell')).toBeVisible()
  const leader = page.getByTestId('orchestrator-chat')
  const initialWidth = (await leader.boundingBox())!.width
  const windows = page.getByTestId('worker-window')
  const windowOf = (task: OrchestratorTask) => windows.and(page.locator(`[data-chat-id="${task.chatId}"]`))
  const run = await call({ action: 'status' })
  await expect(windows).toHaveCount(3)
  for (const task of run.tasks) {
    const worker = windowOf(task)
    await expect(worker).toHaveAttribute('data-chat-id', task.chatId)
    await expect(worker).toHaveAttribute('data-status', 'running')
    await expect(worker).toContainText(`Streaming from ${task.provider}.`)
    await expect(worker).toContainText(task.task)
    await expect(worker).toContainText(new RegExp(task.provider, 'i'))
  }
  await rocket.capture('05-workers-streaming')
  const finished = run.tasks[0]
  await release(finished)
  await expect(windowOf(finished)).toHaveAttribute('data-status', 'done')
  await review(finished)
  await rocket.capture('06-worker-done')
  await windowOf(finished).getByRole('button', { name: 'Open report', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Artifact preview' })).toContainText('Controlled worker report')
  await rocket.capture('07-report-artifact')
  await page.getByRole('button', { name: 'Close artifact', exact: true }).click()
  await windowOf(finished).getByRole('button', { name: 'Expand worker', exact: true }).click()
  const expanded = page.getByTestId('worker-expanded')
  await expect(expanded).toBeVisible()
  const reply = 'Reply observed in worker transcript\nUI check: good evening'
  await expanded.getByRole('textbox', { name: 'Message', exact: true }).fill(reply)
  await expanded.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(expanded).toContainText('Reply observed in worker transcript')
  await expect(expanded).toContainText('Good evening.')
  await rocket.capture('08-worker-expanded-reply')
  // Close only the expanded worker surface. The app itself stays running.
  await expanded.getByRole('button', { name: 'Close expanded worker', exact: true }).click()
  const stopped = run.tasks[1]
  await windowOf(stopped).getByRole('button', { name: 'Stop worker', exact: true }).click()
  await expect(windowOf(stopped)).not.toHaveAttribute('data-status', 'running')
  await expect.poll(async () => (await call({ action: 'status' })).tasks.find(task => task.id === stopped.id)?.status).toBe('interrupted')
  await review(stopped)
  await release(run.tasks[2])
  await review(run.tasks[2])
  await rocket.capture('09-worker-stopped')
  for (let index = 4; index <= 8; index++) {
    const state = await call({ action: 'dispatch', provider: 'claude', task: `UI shell worker ${index}` })
    const task = state.tasks.find(each => each.task === `UI shell worker ${index}`)!
    await expect(windows).toHaveCount(index)
    await expect(windowOf(task)).toContainText('Streaming from claude.')
    if (index < 8) {
      await release(task)
      await expect(windowOf(task)).toHaveAttribute('data-status', 'done')
      await review(task)
    }
  }
  const board = page.getByTestId('worker-board')
  const sizes = await board.evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight }))
  expect(sizes.scroll).toBeGreaterThan(sizes.client)
  expect(Math.abs((await leader.boundingBox())!.width - initialWidth)).toBeLessThanOrEqual(2)
  await board.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(windows.last()).toBeInViewport()
  await rocket.capture('10-eight-workers-board-scrolled')
  await call({ action: 'stop', drain: false })
})
