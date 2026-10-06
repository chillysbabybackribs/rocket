import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './app'

// Hands-free reading (docs/mockups/reading-scroll.html): the page scrolls itself from the toolbar,
// the reader's own scrolling moves it without stopping it, and leaving the page ends it.
test('hands-free reading scrolls the page, follows the reader’s own scrolling and stops on leaving', async ({ rocket }) => {
  const { page, origin, profile } = rocket
  await page.getByRole('button', { name: 'Show browser' }).click()
  const browser = await rocket.surface('browser')
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`${origin}/long`)
  await page.getByRole('textbox', { name: 'Address', exact: true }).press('Enter')
  await expect(browser).toHaveTitle('A long read')
  const scrollY = (): Promise<number> => browser.evaluate(() => window.scrollY)
  // Shortcuts are caught in main before the page sees them (before-input-event), which keys sent
  // over the DevTools protocol skip; these go in as the window's own input does.
  const key = (keyCode: string, modifiers: string[] = []): Promise<void> => rocket.app.evaluate(({ webContents }, [from, code, held]) => {
    const contents = webContents.getAllWebContents().find((each) => each.getURL().startsWith(from as string))!
    contents.sendInputEvent({ type: 'keyDown', keyCode: code as string, modifiers: held as Array<'alt'> })
    contents.sendInputEvent({ type: 'keyUp', keyCode: code as string, modifiers: held as Array<'alt'> })
  }, [origin, keyCode, modifiers] as const)

  await test.step('The button starts the page moving and opens the control', async () => {
    await page.getByRole('button', { name: 'Read hands-free', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect.poll(scrollY).toBeGreaterThan(20)
    await expect(page.locator('.reading-speed')).toHaveText('1×')
    await expect(page.locator('.reading-left')).toContainText('left')
  })

  await test.step('The slider sets the speed, up to 8×', async () => {
    await page.getByRole('slider', { name: 'Reading speed' }).focus()
    await page.keyboard.press('End')
    await expect(page.locator('.reading-speed')).toHaveText('8×')
    const before = await scrollY()
    await page.waitForTimeout(1000)
    expect(await scrollY() - before).toBeGreaterThan(150)
  })

  await test.step('Scrolling back with the wheel moves the page, and reading carries on from there', async () => {
    await expect.poll(scrollY).toBeGreaterThan(1200)
    await browser.mouse.move(300, 300)
    const before = await scrollY()
    await browser.mouse.wheel(0, -800)
    await expect.poll(scrollY).toBeLessThan(before - 300)
    const landed = await scrollY()
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect.poll(scrollY, { timeout: 3000 }).toBeGreaterThan(landed + 60)
  })

  await test.step('Pause holds the page; Space in the page carries on', async () => {
    await page.locator('.reading-readout').dblclick()
    await expect(page.locator('.reading-speed')).toHaveText('1×')
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Carry on', exact: true })).toBeVisible()
    const held = await scrollY()
    await page.waitForTimeout(600)
    expect(await scrollY()).toBe(held)
    // A click in the page would pause it; it is paused already, and it puts the keys in the page.
    await browser.locator('p').nth(3).click()
    await browser.keyboard.press('Space')
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    // Space carried on rather than paging down.
    expect(await scrollY() - held).toBeLessThan(200)
    await rocket.capture('reading')
  })

  await test.step('Esc stops it; Alt+S starts it from the page; leaving the page ends it', async () => {
    await key('Escape')
    await expect(page.getByRole('button', { name: 'Read hands-free', exact: true })).toBeVisible()
    await key('S', ['alt'])
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await key('Down', ['alt'])
    await expect(page.locator('.reading-speed')).toHaveText('1.1×')
    await browser.getByRole('link', { name: 'Next page' }).click()
    await expect(browser).toHaveTitle('UI page one')
    await expect(page.getByRole('button', { name: 'Read hands-free', exact: true })).toBeVisible()
  })

  await test.step('The speed is kept for next time', async () => {
    await expect.poll(async () => JSON.parse(await readFile(join(profile, 'browser-tabs.json'), 'utf8')).readingSpeed).toBe(1.1)
  })
})
