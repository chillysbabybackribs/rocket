import { join } from 'node:path'
import { overlay, test, expect, chatHistory } from './app'
import { seedLongChat } from '../fixtures/long-chat'

// Ctrl + wheel zooms the transcript (src/renderer/src/transcript-zoom.ts): it eases through
// frames rather than jumping, keeps the line under the pointer in place, and comes back out.

test('ctrl + wheel zooms the transcript smoothly around the pointer', async ({ rocket }) => {
  const title = 'Zoom chat'
  seedLongChat(join(rocket.profile, 'rocket.db'), { turns: 20, cwd: rocket.workspace, title, seed: 3 })
  await rocket.restart()
  const { page } = rocket
  await chatHistory(page).click()
  await (await overlay(page, 'menu')).getByRole('menuitem').filter({ hasText: title }).first().click()
  const scroller = page.locator('.pane').first().locator('.transcript')
  await expect(scroller.locator('.turn').first()).toBeVisible()

  // Away from the bottom, so the pointer, not the bottom, is what the zoom holds still.
  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight / 2 })
  const box = (await scroller.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 3
  await page.mouse.move(x, y)

  // The block under the pointer, its offset from the pointer, and every zoom shown on a frame.
  const watch = (): Promise<void> => scroller.evaluate((element, [x, y]) => {
    const w = window as unknown as { zooms: string[]; anchor: { block: Element; along: number } }
    let block = document.elementFromPoint(x, y)!
    while (getComputedStyle(block).display.startsWith('inline')) block = block.parentElement!
    const rect = block.getBoundingClientRect()
    w.anchor = { block, along: (y - rect.top) / rect.height }
    w.zooms = []
    const content = element.querySelector<HTMLElement>('.transcript-inner')!
    const sample = (): void => { w.zooms.push(content.style.zoom); if (w.zooms.length < 60) requestAnimationFrame(sample) }
    requestAnimationFrame(sample)
  }, [x, y] as const)
  const drift = (): Promise<number> => page.evaluate((y) => {
    const { block, along } = (window as unknown as { anchor: { block: Element; along: number } }).anchor
    const rect = block.getBoundingClientRect()
    return Math.abs(rect.top + along * rect.height - y)
  }, y)
  const zooms = (): Promise<number[]> => page.evaluate(() => (window as unknown as { zooms: string[] }).zooms.map(Number))

  await watch()
  await page.keyboard.down('Control')
  for (let notch = 0; notch < 3; notch++) await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await zooms()).length).toBeGreaterThanOrEqual(60)
  const zoomedIn = await zooms()
  const settled = zoomedIn.at(-1)!
  expect(settled).toBeGreaterThan(1.4)
  // Eased: several distinct steps on the way, never past where it stops.
  expect(new Set(zoomedIn.filter((zoom) => zoom > 1 && zoom < settled)).size).toBeGreaterThan(4)
  expect(Math.max(...zoomedIn)).toBe(settled)
  expect(await drift()).toBeLessThan(4)
  expect(Number(await page.evaluate(() => localStorage.getItem('rocket.transcriptZoom')))).toBeCloseTo(settled, 5)

  await watch()
  await page.keyboard.down('Control')
  for (let notch = 0; notch < 3; notch++) await page.mouse.wheel(0, 100)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await zooms()).length).toBeGreaterThanOrEqual(60)
  expect((await zooms()).at(-1)!).toBeCloseTo(1, 5)
  expect(await drift()).toBeLessThan(4)
})
