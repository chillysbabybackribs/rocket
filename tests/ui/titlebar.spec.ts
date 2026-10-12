import { overlay, test, expect, section } from './app'

// There is no rail: the window lights start the title strip, the usage notch hangs at its centre
// with Library and Browser beside it, and the chat card starts at the window's left edge. A ring's
// flyout opens below the notch in a native surface above the browser.
test('usage sits at the centre of the title strip and nothing but the chat uses the left edge', async ({ rocket }) => {
  const { page } = rocket
  const notch = page.locator('.notch')
  const rings = page.getByLabel('Subscription usage', { exact: true })

  await test.step('The chat starts at the left edge; the lights and notch are in the strip', async () => {
    await expect(page.locator('.rail')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Hide the rail' })).toHaveCount(0)
    const chat = (await page.locator('.chat').boundingBox())!
    expect(chat.x).toBeLessThanOrEqual(12)
    const close = (await page.getByRole('button', { name: 'Close window' }).boundingBox())!
    expect(close.y + close.height).toBeLessThanOrEqual(chat.y)
    const box = (await notch.boundingBox())!
    const width = await page.evaluate(() => window.innerWidth)
    expect(box.y).toBe(0)
    expect(box.y + box.height).toBeLessThanOrEqual(chat.y)
    expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(2)
    await expect(rings.locator('.ring')).toHaveCount(4)
    await rocket.capture('titlebar-usage')
  })

  await test.step('With the browser open, a ring\'s native flyout can overlap the page', async () => {
    await (await section(page, 'Browser')).click()
    await expect(page.getByRole('region', { name: 'Browser', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^Antigravity usage/ }).hover()
    const flyout = (await overlay(page, 'flyout')).getByRole('group', { name: 'Antigravity usage', exact: true })
    await expect(flyout).toBeVisible()
    const native = await rocket.app.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v instanceof WebContentsView && (v as InstanceType<typeof WebContentsView>).webContents.getTitle() === 'Rocket overlay: flyout').map(v => v.getBounds())[0])
    const chat = (await page.locator('.chat').boundingBox())!
    expect(native.x + native.width).toBeGreaterThan(chat.x + chat.width)
    const surface = await overlay(page, 'flyout')
    for (const provider of ['Claude', 'Codex', 'Cursor', 'Antigravity']) {
      await page.getByRole('button', { name: new RegExp(`^${provider} usage`) }).hover()
      const group = surface.getByRole('group', { name: `${provider} usage`, exact: true })
      await expect(group).toBeVisible()
      // Visibility alone permits clipping by the native viewport. Check the full panel
      // and every text/control rectangle after its entrance animation settles.
      await expect.poll(() => group.evaluate(element => {
        const viewport = { width: innerWidth, height: innerHeight }
        const nodes = [element, ...element.querySelectorAll('*')]
        return nodes.every(node => {
          const r = node.getBoundingClientRect()
          return r.left >= 0 && r.top >= 0 && r.right <= viewport.width && r.bottom <= viewport.height
        }) && document.body.getBoundingClientRect().x === 0 && getComputedStyle(document.body).padding === '0px'
      })).toBe(true)
    }
    await rocket.capture('titlebar-usage-flyout')
  })
})
