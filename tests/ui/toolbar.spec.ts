import { overlay, test, expect, chatHistory, section } from './app'

// Library and Browser sit on either side of the usage notch; chat history is above
// the composer. Menus use native surfaces above both chat and browser.
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
    await expect(page.getByRole('complementary', { name: 'Library', exact: true })).toBeVisible()
    await rocket.capture('notch-sections')
  })

  await test.step('Chat history opens in a bounded native menu', async () => {
    await chatHistory(page).click()
    const menu = (await overlay(page, 'menu')).getByRole('menu', { name: 'Chat history' })
    await expect(menu).toBeVisible()
    const box = (await menu.boundingBox())!
    expect(box.width).toBeGreaterThan(100)
    expect(box.width).toBeLessThan(await page.evaluate(() => innerWidth))
    await (await overlay(page, 'menu')).keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })
})
