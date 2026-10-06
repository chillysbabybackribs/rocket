import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './app'

test('eval Tools tab loads ledger and supports mark verified', async ({ rocket }) => {
  const { page } = rocket
  test.setTimeout(180_000)
  const state = JSON.parse(await readFile(join(rocket.profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
  const mcp = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`http://127.0.0.1:${state.port}/mcp/${state.secret}/codex/eval-tools`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    })
    const payload = await response.json()
    const result = payload.result as { isError?: boolean; structuredContent?: { error?: { code: string } }; content: Array<{ type: string; text?: string }> }
    let data: any
    try { data = JSON.parse(result.content[0].text!) } catch { data = { error: result.content[0].text } }
    return { result, data }
  }
  const ui = (args: Record<string, unknown>) => mcp('rocket_ui_run', { ...args, target: 'isolated' })

  await ui({ code: `
    await page.locator('.composer-folder').click()
    await page.getByRole('textbox', {name:'Message', exact:true}).fill('UI check: good evening')
    await page.getByRole('button', {name:'Send', exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.prose')?.textContent?.includes('Good evening.'))
    await page.getByRole('button', {name:'Add a chat beside this one', exact:true}).first().click()
    await page.waitForFunction(()=>document.querySelectorAll('.pane').length===2)
    await ui.pane(1).getByRole('textbox', {name:'Message', exact:true}).fill('UI check: good evening')
    await ui.pane(1).getByRole('button', {name:'Send', exact:true}).click()
    return await page.getByText('Good evening.').count()
  ` })

  const failed = await ui({ capture: false, code: `
    await page.getByRole('textbox', {name:'Message', exact:true}).fill('Wrong pane draft')
    return 'should not run'
  ` })
  expect(failed.result.structuredContent?.error?.code).toBe('AMBIGUOUS_TARGET')

  const history = await mcp('rocket_tool_history', { mode: 'calls', tool: 'rocket_ui_run', outcome: 'failure', since: 0, limit: 5 })
  const failId = history.data.calls.find((row: { finish?: { error?: { code: string } } }) => row.finish?.error?.code === 'AMBIGUOUS_TARGET')?.id
  expect(failId).toBeTruthy()

  await page.getByRole('button', { name: 'Show evals', exact: true }).click()
  await page.getByRole('tab', { name: 'Tool health', exact: true }).click()
  const ledger = page.getByLabel('MCP tool ledger')
  await expect(ledger).toBeVisible()
  await expect(ledger.getByText('Prompt injection').locator('..').getByText('Off')).toBeVisible()
  await expect(ledger.getByRole('cell', { name: 'rocket_tool_history' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run all', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Refresh ledger', exact: true })).toBeVisible()

  const queueBefore = await ledger.getByLabel('Review queue count').textContent()
  expect(Number(queueBefore ?? 0)).toBeGreaterThan(0)

  await ledger.getByRole('button', { name: 'Detail' }).first().click()
  await expect(page.getByLabel('Call detail')).toBeVisible()
  await page.getByRole('button', { name: 'Mark call verified', exact: true }).click()

  await page.getByRole('button', { name: 'Refresh ledger', exact: true }).click()
  const queueAfter = await ledger.getByLabel('Review queue count').textContent()
  expect(Number(queueAfter ?? 0)).toBeLessThan(Number(queueBefore ?? 0))

  const queue = await mcp('rocket_tool_review', { action: 'queue', since: 0, limit: 20 })
  expect(queue.data.queue.some((row: { callId: string }) => row.callId === failId)).toBe(false)
})
