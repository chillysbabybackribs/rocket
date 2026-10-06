import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './app'

/** MCP browser tools the way a provider calls them (same pattern as downloads.spec.ts). */
async function browserMcp(profile: string) {
  const state = JSON.parse(await readFile(join(profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
  const url = `http://127.0.0.1:${state.port}/mcp/${state.secret}/claude/browser-phase0`
  const call = async (name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    })
    const { result } = await response.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    return { text: result.content.map((each) => each.text).join('\n'), isError: result.isError }
  }
  const run = async (code: string, timeout = 30) => call('browser_run', { code, timeout })
  return { call, run }
}

test.describe('Browser Phase 0 baseline (harness)', () => {
  test('SPA: hash goto before slow detail fetch finishes (read vs route gap)', async ({ rocket }) => {
    const { origin, profile } = rocket
    const { run } = await browserMcp(profile)
    const detailUrl = `${origin}/spa?slow=1200#/record/alpha`
    const out = await run(`
      await tab.goto(${JSON.stringify(detailUrl)});
      return await tab.read({ max: 4000 });
    `)
    expect(out.isError).toBeFalsy()
    expect(out.text).toMatch(/Loading/)
    expect(out.text).not.toMatch(/ALPHA-42/)
  })

  test('SPA: waitFor after hash goto shows detail', async ({ rocket }) => {
    const { origin, profile } = rocket
    const { run } = await browserMcp(profile)
    const detailUrl = `${origin}/spa#/record/alpha`
    const out = await run(`
      await tab.goto(${JSON.stringify(detailUrl)});
      await tab.waitFor('text=Alpha Corp', { timeout: 8000 });
      return await tab.read({ max: 4000 });
    `)
    expect(out.isError).toBeFalsy()
    expect(out.text).toMatch(/ALPHA-42/)
  })

  test('SPA: JSON extract via browser.fetch', async ({ rocket }) => {
    const { origin, profile } = rocket
    const { run } = await browserMcp(profile)
    const api = `${origin}/spa/api/records/beta`
    const out = await run(`
      const res = await browser.fetch(${JSON.stringify(api)});
      return res.json();
    `)
    expect(out.isError).toBeFalsy()
    expect(out.text).toMatch(/BETA-99/)
  })

  test('SPA: click link + wait reaches detail', async ({ rocket }) => {
    const { origin, profile } = rocket
    const { run } = await browserMcp(profile)
    const out = await run(`
      await tab.goto(${JSON.stringify(`${origin}/spa`)});
      await tab.click('text=Beta LLC');
      await tab.waitFor('text=BETA-99', { timeout: 8000 });
      return await tab.read({ max: 3000 });
    `)
    expect(out.isError).toBeFalsy()
    expect(out.text).toMatch(/BETA-99/)
  })

  test('SPA: ref heal after list rerender (same label, new node)', async ({ rocket }) => {
    const { origin, profile } = rocket
    const { run } = await browserMcp(profile)
    const out = await run(`
      await tab.goto(${JSON.stringify(`${origin}/spa`)});
      const before = await tab.read({ focus: 'elements', max: 2000 });
      const line = before.split('\\n').find((row) => row.includes('Alpha Corp'));
      const ref = line?.match(/\\be\\d+\\b/)?.[0];
      if (!ref) throw new Error('no Alpha Corp ref');
      await tab.click('#rerender');
      await sleep(200);
      await tab.click(ref);
      await tab.waitFor('text=ALPHA-42', { timeout: 8000 });
      return await tab.read({ max: 2000 });
    `)
    expect(out.isError).toBeFalsy()
    expect(out.text).toMatch(/ALPHA-42/)
  })

  test('SPA: network log lists record API on detail navigation', async ({ rocket }) => {
    const { origin, profile } = rocket
    const { run } = await browserMcp(profile)
    const out = await run(`
      await tab.goto(${JSON.stringify(`${origin}/spa`)});
      await tab.click('text=Alpha Corp');
      await tab.waitFor('text=ALPHA-42', { timeout: 8000 });
      return await tab.read({ focus: 'network', max: 40 });
    `)
    expect(out.isError).toBeFalsy()
    expect(out.text).toContain('spa/api/records/alpha')
  })
})
