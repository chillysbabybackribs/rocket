import { test, expect, section } from './app'

// A scenario run from the eval panel, with the controlled test responses: both providers run side
// by side in copies of the scenario's folder, the grid fills in, a cell opens the real transcript,
// and the eval chats stay out of the chat list. The message is edited for the run, which is also
// how a test reaches a known response without a test-only scenario in the user's list.
test('a scenario runs on its providers side by side and a cell opens its transcript', async ({ rocket }) => {
  const { page } = rocket
  test.setTimeout(120_000)
  await (await section(page, 'Evals')).click()
  await expect(page.getByRole('tab', { name: 'Scenarios', exact: true })).toHaveClass(/is-active/)
  await page.getByRole('button', { name: 'Open scenario matrix-smoke' }).click()
  await rocket.capture('evals-scenario')

  const message = page.getByRole('textbox', { name: 'Scenario message' })
  await message.fill('UI check: good evening')
  await expect(page.getByText('Edited: the next run uses this')).toBeVisible()
  await page.getByRole('button', { name: 'Run all', exact: true }).click()

  const claude = page.getByRole('button', { name: 'Open Claude trial 1' })
  const codex = page.getByRole('button', { name: 'Open Codex trial 1' })
  await expect(claude).toContainText('Pass', { timeout: 60_000 })
  await expect(codex).toContainText('Pass', { timeout: 60_000 })
  await expect(page.getByText('edited message').first()).toBeVisible()
  const where = await page.evaluate(() => window.rocketMap.where())
  expect(where.place).toBe('evals.scenario')
  expect(where.evals?.run?.status).toBe('done')
  expect(where.evals?.run?.cells.map((cell) => [cell.provider, cell.pass])).toEqual([['claude', true], ['codex', true]])
  await rocket.capture('evals-run-done')

  await claude.click()
  const transcript = page.locator('.ev-transcript')
  await expect(transcript.locator('.transcript')).toContainText('Good evening.')
  await expect(transcript).toContainText('UI check: good evening')
  await expect(page.getByRole('region', { name: 'Graders' })).toContainText('turn_completed')
  await rocket.capture('evals-cell')

  // Eval chats work under the profile's eval folder and never appear among the user's chats.
  await (await section(page, 'Chats')).click()
  await expect(page.getByRole('menu', { name: 'Chat history' })).toBeVisible()
  await expect(page.getByRole('menu', { name: 'Chat history' })).not.toContainText('[eval]')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'matrix-smoke', exact: true }).click()
  expect((await page.evaluate(() => window.rocketMap.where())).place).toBe('evals.scenario')
})
