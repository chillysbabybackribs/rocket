import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './app'
import { PLACES } from '../../src/shared/app-map.ts'

// The app map is only honest if every place it names can be reached by name in the real app and
// the shell then says it is there. This walks the whole map through the dispatcher, then through
// the host's tools, so the host → main → renderer path is covered too.
test('every place in the app map is reachable by name and reports itself', async ({ rocket }) => {
  const { page } = rocket
  const go = (place: string, params: Record<string, unknown> = {}) => page.evaluate(([place, params]) => window.rocketMap.go(place as string, params as Record<string, unknown>), [place, params] as const)
  const act = (action: string, params: Record<string, unknown> = {}) => page.evaluate(([action, params]) => window.rocketMap.act(action as string, params as Record<string, unknown>), [action, params] as const)

  await test.step('Every parameterless place round-trips, and its control is marked', async () => {
    for (const [place, spec] of Object.entries(PLACES)) {
      if ('params' in spec && spec.params && Object.values(spec.params).some((what) => what.includes('required'))) continue
      const result = await go(place)
      expect(result.ok, `${place}: ${result.ok ? '' : result.error}`).toBe(true)
      expect(result.where.place).toBe(place)
      if (place.startsWith('evals.')) await expect(page.locator(`[data-nav="${place}"]`)).toHaveClass(/is-active/)
    }
    await expect(page.locator('.eval-tools')).toBeVisible()
    await go('chat')
    await expect(page.locator('.eval-panel')).toHaveCount(0)
  })

  await test.step('A required parameter that is missing or wrong is refused with the choices', async () => {
    const missing = await go('evals.scenario')
    expect(missing.ok).toBe(false)
    expect(missing.ok ? '' : missing.error).toContain('Give the scenario\'s id')
    const wrong = await go('evals.scenario', { id: 'no-such-scenario' })
    expect(wrong.ok ? '' : wrong.error).toContain('There is no scenario "no-such-scenario"')
    const noRun = await go('evals.run', { run: 'no-such-run', provider: 'claude' })
    expect(noRun.ok ? '' : noRun.error).toContain('There is no run "no-such-run"')
    const nowhere = await go('evals.nowhere')
    expect(nowhere.ok ? '' : nowhere.error).toContain('There is no place')
  })

  await test.step('Actions run the same code as the buttons and report the panes', async () => {
    const added = await act('pane.add')
    expect(added.ok).toBe(true)
    expect(added.where.panes).toHaveLength(2)
    expect(added.where.focused).toBe(1)
    await expect(page.locator('.pane')).toHaveCount(2)
    const closed = await act('pane.close', { pane: 1 })
    expect(closed.where.panes).toHaveLength(1)
    const refused = await act('pane.close', { pane: 0 })
    expect(refused.ok ? '' : refused.error).toContain('The only pane cannot close')
    // An action belonging to a place opens that place first.
    const refreshed = await act('evals.tools.refresh')
    expect(refreshed.ok).toBe(true)
    expect(refreshed.where.place).toBe('evals.tools')
    await expect(page.locator('[data-nav="evals.tools"]')).toHaveClass(/is-active/)
  })

  await test.step('The host’s tools reach the same dispatcher and add the image', async () => {
    const state = JSON.parse(await readFile(join(rocket.profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
    const mcp = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${state.port}/mcp/${state.secret}/codex/app-map`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      })
      const payload = await response.json() as { result: { isError?: boolean; content: Array<{ type: string; text?: string }> } }
      return { result: payload.result, data: JSON.parse(payload.result.content[0]!.text!) as { where: { place: string; yourPane: number | null }; summary: string } }
    }
    const seen = await mcp('rocket_ui_where', {})
    expect(seen.data.where.place).toBe('evals.tools')
    expect(seen.data.summary).toContain('evals open at evals.tools, health section')
    const went = await mcp('rocket_ui_go', { place: 'evals.scenario', params: { id: 'matrix-smoke' } })
    expect(went.result.isError).toBeFalsy()
    expect(went.data.where.place).toBe('evals.scenario')
    expect(went.result.content.some((part) => part.type === 'image')).toBe(true)
    await expect(page.getByRole('textbox', { name: 'Scenario message' })).toBeVisible()
    const refused = await mcp('rocket_ui_act', { action: 'evals.run.start', params: { scenario: 'no-such-scenario' }, capture: false })
    expect(refused.result.isError).toBe(true)
    expect(refused.result.content[0]!.text).toContain('There is no scenario')
  })
})
