import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './app'

test('default UI scripts operate on the attached live window and leave it open', async ({ rocket }, info) => {
  const state = JSON.parse(await readFile(join(rocket.profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
  const call = async (args: Record<string, unknown>, name = 'rocket_ui_run') => {
    const response = await fetch(`http://127.0.0.1:${state.port}/mcp/${state.secret}/codex/live-inspector`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    })
    const result = (await response.json()).result as { isError?: boolean; structuredContent?: { error?: { code: string; origin: string } }; content: Array<{ type: string; text?: string }> }
    let data: any
    try { data = JSON.parse(result.content[0].text!) } catch { data = { error: result.content[0].text } }
    return { result, data }
  }
  const pid = await rocket.app.evaluate(() => process.pid)
  await rocket.page.locator('.composer-folder').click()
  await rocket.page.getByRole('textbox', { name: 'Message', exact: true }).fill('Existing live draft')
  const first = await call({ code: `
    await page.getByRole('button',{name:'Add a chat beside this one',exact:true}).first().click()
    await page.waitForFunction(()=>document.querySelectorAll('.pane').length===2)
    await page.locator('.pane').last().getByRole('textbox',{name:'Message',exact:true}).fill('New live draft')
    return await page.locator('.pane').count()
  ` })
  expect(first.result.isError, JSON.stringify(first.data)).toBeUndefined()
  expect(first.data.target).toBe('live')
  expect(first.data.session.pid).toBe(pid)
  expect(first.data.value).toBe(2)
  expect(first.data.captures[0].instance.pid).toBe(pid)
  await expect(rocket.page.locator('.pane')).toHaveCount(2)
  await expect(rocket.page.getByRole('textbox', { name: 'Message', exact: true }).first()).toHaveValue('Existing live draft')
  await expect(rocket.page.getByRole('textbox', { name: 'Message', exact: true }).last()).toHaveValue('New live draft')
  await info.attach('Live UI: added chat pane', { path: first.data.captures[0].images[0].path, contentType: 'image/png' })
  const second = await call({ code: `
    await page.getByRole('button',{name:'Sections',exact:true}).click()
    await page.getByRole('button',{name:'Browser',exact:true}).click()
    const browser = await ui.surface('browser')
    await browser.getByRole('textbox',{name:'Test input',exact:true}).fill('Live browser draft')
    return await page.locator('.pane').last().getByRole('textbox',{name:'Message',exact:true}).inputValue()
  ` })
  expect(second.result.isError, JSON.stringify(second.data)).toBeUndefined()
  expect(second.data.value).toBe('New live draft')
  await expect((await rocket.surface('browser')).getByRole('textbox', { name: 'Test input', exact: true })).toHaveValue('Live browser draft')
  const failed = await call({ capture: false, code: `throw new Error('Deliberate live failure')` })
  expect(failed.result.isError).toBe(true)
  expect(failed.result.structuredContent?.error?.code).toBe('SCRIPT_ERROR')
  expect(failed.result.content.some(item => item.type === 'image')).toBe(true)
  const ambiguous = await call({ capture: false, code: `await page.getByRole('textbox',{name:'Message',exact:true}).fill('Ambiguous draft')` })
  expect(ambiguous.result.structuredContent?.error?.code).toBe('AMBIGUOUS_TARGET')
  expect(ambiguous.result.structuredContent?.error?.origin).toBe('operation')
  const timedOut = await call({ timeout: 1, code: 'while(true) {}' })
  expect(timedOut.result.isError).toBe(true)
  expect(timedOut.data.timedOut).toBe(true)
  expect(timedOut.result.structuredContent?.error?.code).toBe('SCRIPT_TIMEOUT')
  expect(timedOut.data.session.open).toBe(true)
  const after = await call({ capture: false, code: `return await page.locator('.pane').count()` })
  expect(after.result.isError, JSON.stringify(after.data)).toBeUndefined()
  expect(after.data.value).toBe(2)
  expect(after.data.session.pid).toBe(pid)
  await expect(rocket.page.getByRole('textbox', { name: 'Message', exact: true }).last()).toHaveValue('New live draft')
  const history = await call({ mode: 'summary', tool: 'rocket_ui_run', code: 'AMBIGUOUS_TARGET' }, 'rocket_tool_history')
  expect(history.result.isError, JSON.stringify(history.data)).toBeUndefined()
  expect(history.data.groups[0].count).toBe(1)
  expect(history.data.groups[0].successes).toBe(3)
  expect(history.data.groups[0].failures).toBe(3)
  expect(history.data.groups[0].failureRate).toBe(0.5)
  const detail = await call({ callId: history.data.groups[0].examples[0] }, 'rocket_tool_history')
  expect(detail.data.calls[0].finish.error.code).toBe('AMBIGUOUS_TARGET')
  expect(detail.data.calls[0].arguments.code).toContain('[REDACTED]')
  expect(detail.data.calls[0].finish.artifacts.length).toBeGreaterThan(0)
})
