import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './app'

// Regression for ledger lesson: duplicate greeting text in one pane must not replace stable pane index selection.
test('ui.pane targets the intended chat when the same greeting appears elsewhere', async ({ rocket }, info) => {
  test.setTimeout(180_000)
  const state = JSON.parse(await readFile(join(rocket.profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
  const call = async (args: Record<string, unknown>) => {
    const response = await fetch(`http://127.0.0.1:${state.port}/mcp/${state.secret}/codex/pane-selector-regression`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'rocket_ui_run', arguments: { ...args, target: 'isolated' } } })
    })
    const result = (await response.json()).result as { isError?: boolean; structuredContent?: { error?: { code: string } }; content: Array<{ type: string; text?: string }> }
    let data: any
    try { data = JSON.parse(result.content[0].text!) } catch { data = { error: result.content[0].text } }
    return { result, data }
  }

  const setup = await call({ code: `
    await page.locator('.composer-folder').click()
    await page.getByRole('textbox', {name:'Message', exact:true}).fill('UI check: good evening')
    await page.getByRole('button', {name:'Send', exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.prose')?.textContent?.includes('Good evening.'))
    await page.getByRole('button', {name:'Add a chat beside this one', exact:true}).first().click()
    await page.waitForFunction(()=>document.querySelectorAll('.pane').length===2)
    await ui.pane(1).getByRole('textbox', {name:'Message', exact:true}).fill('UI check: good evening')
    await ui.pane(1).getByRole('button', {name:'Send', exact:true}).click()
    await page.waitForFunction(()=>document.querySelectorAll('.prose').length>=2)
    return await page.getByText('Good evening.').count()
  ` })
  expect(setup.result.isError, JSON.stringify(setup.data)).toBeUndefined()
  expect(setup.data.value).toBe(2)

  const ambiguous = await call({ capture: false, code: `
    await page.getByRole('textbox', {name:'Message', exact:true}).fill('Wrong pane draft')
    return 'should not run'
  ` })
  expect(ambiguous.result.structuredContent?.error?.code).toBe('AMBIGUOUS_TARGET')

  const scoped = await call({ code: `
    await ui.pane(1).getByRole('textbox', {name:'Message', exact:true}).fill('Right pane draft')
    return await ui.pane(1).getByRole('textbox', {name:'Message', exact:true}).inputValue()
  ` })
  expect(scoped.result.isError, JSON.stringify(scoped.data)).toBeUndefined()
  expect(scoped.data.value).toBe('Right pane draft')
  await info.attach('Pane selector regression', { path: scoped.data.captures[0].images[0].path, contentType: 'image/png' })
})
