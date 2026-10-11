import { test, expect, section } from './app'

// The address field keeps the keyboard while a page navigates under it (Electron focuses a page
// on navigation unless told not to; browser-pane.ts), and fills in a visited site after what is
// typed, as Chrome does: Enter opens it, Backspace takes it back.
test('the address field keeps focus while the page navigates and fills in a visited address', async ({ rocket }) => {
  const { page, origin } = rocket
  const host = new URL(origin).host
  await (await section(page, 'Browser')).click()
  const browser = await rocket.surface('browser')
  await expect(browser).toHaveTitle('UI page one')
  const address = page.getByRole('textbox', { name: 'Address', exact: true })
  const selection = () => address.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])

  await address.click()
  await address.pressSequentially('127.0', { delay: 40 })
  // The page goes somewhere by itself while the user is mid-word.
  await browser.evaluate(() => { location.href = '/two' })
  await expect(browser).toHaveTitle('UI page two')
  await address.pressSequentially('.0', { delay: 40 })
  await expect(address).toBeFocused()
  await expect(address).toHaveValue(host)
  expect(await selection()).toEqual([7, host.length])
  const suggestions = await rocket.surface('suggestions')
  await expect(suggestions.locator('.row.is-selected')).toContainText(host)

  // Backspace removes only what was filled in, and it stays removed when the rows come back.
  await address.press('Backspace')
  await expect(address).toHaveValue('127.0.0')
  await expect(suggestions.locator('.row').first()).toContainText('127.0.0')
  await expect(address).toHaveValue('127.0.0')

  // With a path begun, it fills in a page; Enter opens it.
  await address.pressSequentially(`${host.slice(7)}/o`, { delay: 20 })
  await expect(address).toHaveValue(`${host}/one`)
  await address.press('Enter')
  await expect(browser).toHaveTitle('UI page one')
})
