import { test, expect } from './app'

// The rail folds to a strip to give the chat its width. The strip keeps the window lights and a
// dot per provider, peeks the whole rail over the chat while the pointer rests on it, and the
// fold survives a restart. The rail holds no section buttons: those are the toolbar's.
test('the rail folds to a strip, peeks on hover and comes back', async ({ rocket }) => {
  const { page } = rocket
  const app = page.locator('.app')
  const chat = page.locator('.chat')

  await test.step('Folding gives the chat the width and keeps the lights', async () => {
    const before = await chat.boundingBox()
    await page.getByRole('button', { name: 'Hide the rail' }).click()
    await expect(app).toHaveClass(/rail-folded/)
    const after = await chat.boundingBox()
    expect(after!.width - before!.width).toBeGreaterThan(40)
    expect(after!.x).toBeLessThan(before!.x)
    await expect(page.getByRole('button', { name: 'Close window' })).toBeVisible()
    await expect(page.locator('.rail-dot')).toHaveCount(4)
    await expect(page.locator('.rail [data-section], .rail [data-nav]')).toHaveCount(0)
    await rocket.capture('rail-folded')
  })

  await test.step('Hovering the strip peeks the rail over the chat, which does not move', async () => {
    const before = await chat.boundingBox()
    await page.locator('.rail-dots').hover()
    const peek = page.locator('.rail-peek')
    await expect(peek).toBeVisible()
    await expect(peek.locator('.ring')).toHaveCount(4)
    await expect(peek.getByRole('button', { name: 'Show the rail', exact: true })).toBeVisible()
    expect(await chat.boundingBox()).toEqual(before)
    await rocket.capture('rail-peek')
    // Leaving puts it back.
    await page.getByRole('textbox', { name: 'Message', exact: true }).hover()
    await expect(peek).toHaveCount(0)
  })

  await test.step('The fold survives a restart; the strip\'s button brings the rail back', async () => {
    await rocket.restart()
    const page = rocket.page
    await expect(page.locator('.app')).toHaveClass(/rail-folded/)
    await page.getByRole('button', { name: 'Show the rail' }).click()
    await expect(page.locator('.app')).not.toHaveClass(/rail-folded/)
    await expect(page.getByRole('button', { name: 'Hide the rail', exact: true })).toBeVisible()
    await expect(page.locator('.ring')).toHaveCount(4)
  })
})
