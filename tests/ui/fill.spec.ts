import type { Page } from '@playwright/test'
import { test, expect, section } from './app'

// Fill with Rocket (docs/mockups/fill-with-rocket.html): right-click a field or a form and the
// model writes the answer into the page, with a chip beside it that says what it is doing. The
// native menu cannot be clicked from a test, so the menu's template is caught as main builds it
// and its item is clicked from there; the controlled provider answers the fill (src/host/ui-test.ts).
test('Fill with Rocket fills a field, a rich editor and a form, undoes, reworks, and stops on Esc', async ({ rocket }) => {
  const { page, app, origin } = rocket
  await app.evaluate(({ Menu }) => {
    const scope = globalThis as unknown as { menus: Array<Array<{ label?: string; click?: () => void }>> }
    scope.menus = []
    const build = Menu.buildFromTemplate.bind(Menu)
    Menu.buildFromTemplate = (template) => {
      // Submenus are built the same way; only the page's own menu, which ends with Inspect, counts.
      if (template.some((item) => (item as { label?: string }).label === 'Inspect')) scope.menus.push(template as never)
      const menu = build(template)
      menu.popup = () => {}
      return menu
    }
  })
  const lastMenu = (): Promise<string[]> => app.evaluate(() => {
    const scope = globalThis as unknown as { menus: Array<Array<{ label?: string }>> }
    return (scope.menus.at(-1) ?? []).map((item) => item.label ?? '-')
  })
  const choose = (prefix: string): Promise<void> => app.evaluate((_electron, wanted) => {
    const scope = globalThis as unknown as { menus: Array<Array<{ label?: string; click?: () => void }>> }
    const item = scope.menus.at(-1)?.find((entry) => entry.label?.startsWith(wanted))
    if (!item?.click) throw new Error(`No menu item starts with ${wanted}`)
    item.click()
  }, prefix)
  const rightClick = async (browser: Page, selector: string, prefix: string): Promise<void> => {
    const before = (await app.evaluate(() => (globalThis as unknown as { menus: unknown[] }).menus.length))
    await browser.locator(selector).click({ button: 'right' })
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { menus: unknown[] }).menus.length)).toBeGreaterThan(before)
    const labels = await lastMenu()
    expect(labels.some((label) => label.startsWith(prefix)), `menu was: ${labels.join(' | ')}`).toBe(true)
  }

  // Whether the chip's view is on screen: a concealed view is hidden, or parked past the window's edge.
  const chipShown = (): Promise<boolean> => app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const [width] = window.getContentSize()
    return window.contentView.children.some((view) => {
      const url = (view as { webContents?: { getURL: () => string } }).webContents?.getURL() ?? ''
      return url.endsWith('/fill.html') && view.getVisible() && view.getBounds().x < width - 2
    })
  })

  await (await section(page, 'Browser')).click()
  const browser = await rocket.surface('browser')
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`${origin}/forum`)
  await page.getByRole('textbox', { name: 'Address', exact: true }).press('Enter')
  await expect(browser).toHaveTitle('Desktop forum')
  const reply = browser.locator('#reply')

  await test.step('A field offers the fill first in its menu, and the chip says what the model is doing', async () => {
    await rightClick(browser, '#reply', 'Fill with Rocket')
    const labels = await lastMenu()
    expect(labels.indexOf('Fill with instructions…')).toBe(1)
    expect(labels).toContain('Paste')
    await choose('Fill with Rocket')
    const chip = await rocket.surface('fill')
    await expect(chip.locator('.chip')).toContainText(/Reading|Opening/)
    await expect(chip.locator('.count')).toHaveText('1')
    // One width from start to finish.
    expect(Math.round((await chip.locator('.chip').boundingBox())!.width)).toBe(500)
    await expect(page.locator('.btab.is-filling')).toHaveCount(1)
    await expect(reply).toHaveValue('')
    await expect(reply).toHaveValue('Filled by claude: Your reply\nSecond line.')
    await expect(chip.locator('.chip')).toContainText('Filled')
    await expect(page.locator('.btab.is-filling')).toHaveCount(0)
    await expect(browser.locator('#posted')).toHaveText('Not posted')
  })

  await test.step('Sources lists what the turn opened, only when asked', async () => {
    const chip = await rocket.surface('fill')
    await expect(chip.locator('.drop')).toHaveCount(0)
    await chip.getByRole('button', { name: /Sources/ }).click()
    await expect(chip.locator('.drop')).toContainText('Opened while filling')
    await expect(chip.locator('.drop .item')).toHaveCount(1)
    await expect(chip.locator('.drop')).toContainText('wiki.example/rules')
    await rocket.capture('fill-done')
  })

  await test.step('Sound like you reworks what is there, and Undo puts back what the field held before', async () => {
    const chip = await rocket.surface('fill')
    await chip.getByRole('button', { name: /Another go/ }).click()
    await chip.getByRole('button', { name: 'Sound like you' }).click()
    await expect(reply).toHaveValue('In your voice by claude: Your reply\nSecond line.')
    await expect(chip.locator('.chip')).toContainText('In your voice')
    await chip.getByRole('button', { name: 'Undo' }).click()
    await expect(reply).toHaveValue('Filled by claude: Your reply\nSecond line.')
    await expect.poll(chipShown).toBe(false)
  })

  await test.step('With instructions asks first, without highlighting anything, then fills', async () => {
    await reply.fill('')
    await rightClick(browser, '#reply', 'Fill with instructions…')
    await choose('Fill with instructions…')
    const chip = await rocket.surface('fill')
    const input = chip.getByRole('textbox', { name: 'Instructions for the fill' })
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('')
    await input.fill('keep it short')
    await input.press('Enter')
    await expect(reply).toHaveValue('Filled by claude: Your reply\nSecond line.')
  })

  await test.step('A rich editor takes the fill as its own paragraphs', async () => {
    await rightClick(browser, '#rich', 'Fill with Rocket')
    await choose('Fill with Rocket')
    await expect(browser.locator('#rich')).toContainText('Filled by claude: Rich reply')
    await expect(browser.locator('#rich')).toContainText('Second line.')
  })

  await test.step('A form fills every text field it can, leaves the email for the user and never the password, and is not submitted', async () => {
    await rightClick(browser, '#issue input[name="title"]', 'Fill this form with Rocket (3 fields)')
    await choose('Fill this form with Rocket')
    await expect(browser.locator('input[name="title"]')).toHaveValue('Filled by claude: Title\nSecond line.'.replace('\n', ''))
    await expect(browser.locator('textarea[name="body"]')).toHaveValue('Filled by claude: What happened\nSecond line.')
    await expect(browser.locator('input[name="email"]')).toHaveValue('')
    await expect(browser.locator('input[name="password"]')).toHaveValue('')
    const chip = await rocket.surface('fill')
    await expect(chip.locator('.chip')).toContainText('2 of 3')
    await expect(chip.locator('.chip')).toContainText('1 for you')
    await expect(chip.locator('.what')).toHaveAttribute('title', 'Left for you: Contact email (needs your email)')
    // Nothing in the chip is cut short.
    expect(await chip.locator('.what').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect(browser).toHaveTitle('Desktop forum')
    await rocket.capture('fill-form')
  })

  await test.step('Esc in the page stops a fill in flight and leaves the field as it was', async () => {
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`${origin}/hold`)
    await page.getByRole('textbox', { name: 'Address', exact: true }).press('Enter')
    await expect(browser).toHaveTitle('A slow thread')
    await rightClick(browser, '#reply', 'Fill with Rocket')
    await choose('Fill with Rocket')
    const chip = await rocket.surface('fill')
    await expect(chip.getByRole('button', { name: 'Stop' })).toBeVisible()
    await app.evaluate(({ webContents }, from) => {
      const contents = webContents.getAllWebContents().find((each) => each.getURL().startsWith(`${from}/hold`))!
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    }, origin)
    await expect(page.locator('.btab.is-filling')).toHaveCount(0)
    await expect(browser.locator('#reply')).toHaveValue('')
    // The stopped fill's chat is gone, and none ever reached the chat list.
    await (await section(page, 'Chats')).click()
    await expect(page.getByText('Fill', { exact: true })).toHaveCount(0)
  })
})
