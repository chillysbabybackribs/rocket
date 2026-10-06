import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './app'

// End-to-end learning loop: failure evidence → review → fix path → verified, without live-chat replay.
test('tool failure history supports review through verified fix', async ({ rocket }, info) => {
  test.setTimeout(180_000)
  const state = JSON.parse(await readFile(join(rocket.profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
  const mcp = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`http://127.0.0.1:${state.port}/mcp/${state.secret}/codex/tool-failure-loop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    })
    const result = (await response.json()).result as { isError?: boolean; structuredContent?: { error?: { code: string } }; content: Array<{ type: string; text?: string }> }
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
    await page.getByRole('textbox', {name:'Message', exact:true}).fill('Ambiguous')
    return false
  ` })
  expect(failed.result.structuredContent?.error?.code).toBe('AMBIGUOUS_TARGET')

  const history = await mcp('rocket_tool_history', { mode: 'calls', tool: 'rocket_ui_run', outcome: 'failure', since: 0, limit: 5 })
  const failId = history.data.calls.find((row: { finish?: { error?: { code: string } } }) => row.finish?.error?.code === 'AMBIGUOUS_TARGET')?.id
  expect(failId).toBeTruthy()

  const diagnosed = await mcp('rocket_tool_review', { action: 'annotate', callId: failId, lifecycle: 'diagnosed', causeCode: 'AMBIGUOUS_TARGET', proposedFix: 'ui.pane(index)' })
  expect(diagnosed.result.isError, JSON.stringify(diagnosed.data)).toBeFalsy()

  await mcp('rocket_tool_review', { action: 'annotate', callId: failId, lifecycle: 'regression_added' })

  const fixed = await ui({ code: `
    await ui.pane(1).getByRole('textbox', {name:'Message', exact:true}).fill('Loop verified draft')
    return await ui.pane(1).getByRole('textbox', {name:'Message', exact:true}).inputValue()
  ` })
  expect(fixed.data.value).toBe('Loop verified draft')
  const retryId = (await mcp('rocket_tool_history', { mode: 'calls', tool: 'rocket_ui_run', outcome: 'success', since: 0, limit: 1 })).data.calls[0]?.id
  expect(retryId).toBeTruthy()

  const linked = await mcp('rocket_tool_review', { action: 'link_retry', callId: failId, retryCallId: retryId })
  expect(linked.data.review.retryCallId).toBe(retryId)
  await mcp('rocket_tool_review', { action: 'annotate', callId: failId, lifecycle: 'fixed' })
  const verified = await mcp('rocket_tool_review', { action: 'annotate', callId: failId, lifecycle: 'verified' })
  expect(verified.data.review.lifecycle).toBe('verified')

  const detail = await mcp('rocket_tool_history', { callId: failId })
  expect(detail.data.calls[0].review.lifecycle).toBe('verified')
  expect(detail.data.calls[0].finish.error.code).toBe('AMBIGUOUS_TARGET')
  expect(detail.data.calls[0].review.retryCallId).toBe(retryId)

  const queue = await mcp('rocket_tool_review', { action: 'queue', since: 0, limit: 10 })
  expect(queue.data.queue.some((row: { callId: string }) => row.callId === failId)).toBe(false)

  const summary = await mcp('rocket_tool_history', { mode: 'summary', tool: 'rocket_ui_run', since: 0, limit: 5 })
  expect(summary.data.contextPolicy.historyInPrompts).toBe(false)
  expect(summary.data.scopes[0].descriptionBytes).toBeGreaterThan(0)
  await info.attach('Tool failure loop verified', { path: fixed.data.captures[0].images[0].path, contentType: 'image/png' })
})
