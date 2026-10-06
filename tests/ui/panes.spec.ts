import { test, expect } from './app'

// The chat card splits into panes from the add-chat button in the composer's text line: two side
// by side, three as two above one across, four as quadrants. Each pane is a chat of its own, a
// turn streams only into the pane that shows its chat, and the layout comes back after a restart.
test('the add-chat button splits the card into up to four chats, each its own', async ({ rocket }) => {
  const { page } = rocket
  const panes = page.locator('.pane')
  const add = page.getByRole('button', { name: 'Add a chat beside this one' })

  await test.step('The button sits beside the text, not under it', async () => {
    await expect(panes).toHaveCount(1)
    const button = await add.boundingBox()
    const message = page.getByRole('textbox', { name: 'Message', exact: true })
    const box = await message.boundingBox()
    const padding = await message.evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft))
    expect(button!.x + button!.width).toBeLessThanOrEqual(box!.x + padding)
  })

  await test.step('A second pane opens as a new chat and takes the focus', async () => {
    await page.locator('.composer-folder').first().click()
    await add.first().click()
    await expect(panes).toHaveCount(2)
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(2)
    await expect(panes.nth(1)).toHaveClass(/is-focused/)
    await expect(panes.nth(1).getByRole('tab')).toHaveText('New chat')
    const [left, right] = await Promise.all([panes.nth(0).boundingBox(), panes.nth(1).boundingBox()])
    expect(right!.x).toBeGreaterThan(left!.x + left!.width - 2)
    expect(Math.abs(right!.y - left!.y)).toBeLessThan(2)
  })

  await test.step('A turn streams only into the pane that shows its chat', async () => {
    const first = panes.nth(0)
    await first.getByRole('textbox', { name: 'Message', exact: true }).fill('UI check: stream')
    await first.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(first.locator('.turn')).toHaveCount(1)
    await expect(first.locator('.prose').last()).toContainText('Streaming from claude.')
    await expect(panes.nth(1).locator('.turn')).toHaveCount(0)
    await expect(first).toHaveClass(/is-focused/)
    await rocket.release()
    await expect(first.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await rocket.capture('panes-two')
  })

  await test.step('Three panes: two above, one across; four: quadrants, and no more', async () => {
    await add.first().click()
    await expect(panes).toHaveCount(3)
    const card = await page.locator('.chat').boundingBox()
    const [top, bottom] = await Promise.all([panes.nth(0).boundingBox(), panes.nth(2).boundingBox()])
    expect(bottom!.width).toBeGreaterThan(card!.width - 4)
    expect(bottom!.y).toBeGreaterThan(top!.y + top!.height - 2)
    await add.first().click()
    await expect(panes).toHaveCount(4)
    await expect(add).toHaveCount(4)
    for (const button of await add.all()) await expect(button).toBeDisabled()
    await expect(add.first()).toHaveAttribute('title', 'Four chats is the most for now')
    await rocket.capture('panes-four')
  })

  await test.step('The layout survives a restart', async () => {
    await rocket.restart()
    const page = rocket.page
    await expect(page.locator('.pane')).toHaveCount(4)
    await expect(page.locator('.pane').nth(0).locator('.turn')).toHaveCount(1)
  })

  await test.step('Closing a pane\'s last tab closes the pane', async () => {
    const page = rocket.page
    const closeNew = page.getByRole('button', { name: 'Close this chat pane' })
    await closeNew.last().click()
    await expect(page.locator('.pane')).toHaveCount(3)
    await closeNew.last().click()
    await closeNew.last().click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane').locator('.turn')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Add a chat beside this one' })).toBeEnabled()
    // The only pane never closes: its last tab closing shows the new-chat screen instead.
    await page.getByRole('button', { name: /^Close tab:/ }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane')).toHaveClass(/is-empty/)
  })
})
