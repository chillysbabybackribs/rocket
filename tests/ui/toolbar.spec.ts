import { test, expect, chatHistory, section } from './app'

// Library and Browser sit as plain text on either side of the usage notch; chat history is above
// the composer. Menus stay inside the chat card, clear of the browser's native page.
test('side panels and chat history open from the title strip and composer', async ({ rocket }) => {
  const { page } = rocket
  const library = await section(page, 'Library')
  const browser = await section(page, 'Browser')

  await test.step('Library and Browser are always visible beside the usage notch', async () => {
    await expect(library).toBeVisible()
    await expect(browser).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sections', exact: true })).toHaveCount(0)
    await browser.click()
    await expect(page.getByRole('region', { name: 'Browser', exact: true })).toBeVisible()
    await expect(browser).toHaveAttribute('aria-pressed', 'true')
    await library.click()
    await expect(page.getByRole('region', { name: 'Library', exact: true })).toBeVisible()
    await rocket.capture('notch-sections')
  })

  await test.step('Chat history opens beside the composer and stays inside the chat card', async () => {
    await chatHistory(page).click()
    const menu = page.getByRole('menu', { name: 'Chat history' })
    await expect(menu).toBeVisible()
    const box = (await menu.boundingBox())!
    const chat = (await page.locator('.chat').boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(chat.x + chat.width)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })
})
