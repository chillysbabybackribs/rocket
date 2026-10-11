import { test, expect, section } from './app'

test('the middle divider resizes the chat and browser panes with click to drag', async ({ rocket }) => {
  const { page } = rocket

  // Open the browser
  await (await section(page, 'Browser')).click()
  const browser = page.locator('.browser')
  const chat = page.locator('.chat')
  const divider = page.getByRole('separator', { name: 'Resize chat and browser panes' })

  await expect(browser).toBeVisible()
  await expect(divider).toBeVisible()

  const initialChatBox = await chat.boundingBox()
  const initialBrowserBox = await browser.boundingBox()
  const dividerBox = await divider.boundingBox()

  expect(initialChatBox).not.toBeNull()
  expect(initialBrowserBox).not.toBeNull()
  expect(dividerBox).not.toBeNull()

  // The divider is positioned between the chat card and browser card
  expect(dividerBox!.x).toBeGreaterThanOrEqual(initialChatBox!.x + initialChatBox!.width - 2)
  expect(initialBrowserBox!.x).toBeGreaterThanOrEqual(dividerBox!.x + dividerBox!.width - 2)

  // Drag the divider to the left (increasing browser width, decreasing chat width)
  const dragDistance = 80
  await divider.dispatchEvent('pointerdown', { pointerId: 1, button: 0, clientX: dividerBox!.x + dividerBox!.width / 2, clientY: dividerBox!.y + 100 })
  await divider.dispatchEvent('pointermove', { pointerId: 1, clientX: dividerBox!.x - dragDistance, clientY: dividerBox!.y + 100 })
  await divider.dispatchEvent('pointerup', { pointerId: 1, clientX: dividerBox!.x - dragDistance, clientY: dividerBox!.y + 100 })

  const resizedChatBox = await chat.boundingBox()
  const resizedBrowserBox = await browser.boundingBox()

  // Browser should have grown wider, chat should have shrunk
  expect(resizedBrowserBox!.width).toBeGreaterThan(initialBrowserBox!.width + 40)
  expect(resizedChatBox!.width).toBeLessThan(initialChatBox!.width - 40)

  // Double click resets the width
  await divider.dblclick()
  const resetBrowserBox = await browser.boundingBox()
  expect(Math.abs(resetBrowserBox!.width - initialBrowserBox!.width)).toBeLessThan(5)

  // Keyboard navigation: ArrowLeft increases browser width
  await divider.focus()
  await page.keyboard.press('ArrowLeft')
  const keyboardBrowserBox = await browser.boundingBox()
  expect(keyboardBrowserBox!.width).toBeGreaterThan(resetBrowserBox!.width)

  // Enter resets
  await page.keyboard.press('Enter')
  const keyboardResetBox = await browser.boundingBox()
  expect(Math.abs(keyboardResetBox!.width - initialBrowserBox!.width)).toBeLessThan(5)

  await rocket.capture('browser-resized')
})
