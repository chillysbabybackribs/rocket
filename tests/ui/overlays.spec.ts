import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { overlay, test, expect, section } from './app'
import { jpegBase64 } from '../fixtures/image'

test('native image preview leaves the active browser visible and unchanged', async ({ rocket }) => {
  const { page, app } = rocket
  await page.locator('.composer-folder').click()
  await page.locator('.image-file-input').setInputFiles({ name: 'overlay.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegBase64, 'base64') })
  await (await section(page, 'Browser')).click()
  const browser = await rocket.surface('browser')
  await expect(browser.getByRole('heading', { name: 'Rocket browser check' })).toBeVisible()
  await browser.evaluate(() => {
    const log = { visibility: 0, resizes: 0, frames: 0 }
    Object.assign(window, { overlayCheck: log })
    document.addEventListener('visibilitychange', () => log.visibility++)
    window.addEventListener('resize', () => log.resizes++)
    const tick = () => { log.frames++; requestAnimationFrame(tick) }
    tick()
  })
  const native = () => app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win.contentView.children.filter(v => v instanceof WebContentsView)
      .map(v => ({ id: (v as InstanceType<typeof WebContentsView>).webContents.id, url: (v as InstanceType<typeof WebContentsView>).webContents.getURL(), visible: v.getVisible(), bounds: v.getBounds() }))
  })
  const before = (await native()).find(v => v.url.startsWith(rocket.origin))!
  await page.getByRole('button', { name: 'Preview overlay.jpg' }).click()
  await expect.poll(async () => {
    for (const p of app.context().pages()) if (await p.title() === 'Rocket overlay: modal') return true
    return false
  }).toBe(true)
  const modal = (await Promise.all(app.context().pages().map(async p => ({ p, title: await p.title() })))).find(x => x.title === 'Rocket overlay: modal')!.p
  await expect(modal.locator('dialog[open] > img')).toBeVisible()
  expect((await native()).find(v => v.id === before.id)).toEqual(before)
  await rocket.capture('native-image-overlay')
  await modal.keyboard.press('Escape')
  await expect(modal.locator('dialog[open]')).toHaveCount(0)
  expect((await native()).find(v => v.id === before.id)).toEqual(before)
  const log = await browser.evaluate(() => (window as unknown as { overlayCheck: { visibility: number; resizes: number; frames: number } }).overlayCheck)
  expect(log.visibility).toBe(0)
  expect(log.resizes).toBe(0)
  expect(log.frames).toBeGreaterThan(2)
})

test('repeated native overlays keep page pixels, input, scrolling and focus intact', async ({ rocket }, info) => {
  const { page, app } = rocket
  await page.locator('.composer-folder').click()
  await page.locator('.image-file-input').setInputFiles({ name: 'overlay.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegBase64, 'base64') })
  await (await section(page, 'Browser')).click()
  const browser = await rocket.surface('browser')
  await expect(browser.getByRole('heading', { name: 'Rocket browser check' })).toBeVisible()
  await browser.getByLabel('Test input').fill('Preserve this form')
  await browser.evaluate(() => {
    document.body.style.minHeight = '2500px'
    const marker = document.createElement('div')
    marker.id = 'overlay-pixel-marker'
    marker.style.cssText = 'position:fixed;right:20px;bottom:20px;width:60px;height:40px;background:linear-gradient(to right,#00ff00 0 33.333%,#ff00ff 33.333% 66.666%,#0000ff 66.666%);z-index:999'
    document.body.append(marker)
    // A playing media element exercises playback while the modal owns keyboard focus.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const video = document.createElement('video')
    video.id = 'overlay-video'
    video.muted = true
    video.style.cssText = 'position:fixed;right:100px;bottom:20px;width:32px;height:32px'
    video.srcObject = canvas.captureStream(30)
    document.body.append(video)
    const tick = () => {
      const context = canvas.getContext('2d')!
      context.fillStyle = Math.floor(performance.now() / 100) % 2 ? '#c04020' : '#2040c0'
      context.fillRect(0, 0, 32, 32)
      requestAnimationFrame(tick)
    }
    tick()
    void video.play()
    window.scrollTo(0, 80)
  })
  const before = await browser.evaluate(() => ({ href: location.href, scroll: scrollY, width: innerWidth, height: innerHeight }))
  const modal = await overlay(page, 'modal')
  const menu = await overlay(page, 'menu')
  const state = () => app.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows()[0].contentView.children
    .filter(v => v instanceof WebContentsView && (v as InstanceType<typeof WebContentsView>).webContents.getTitle() === 'Rocket overlay: modal')
    .map(v => v.getVisible())[0])

  // Record the actual X11 display, including native sibling surfaces, at 60 fps.
  // The ordinary lifecycle tests also run on Wayland; this pixel proof needs X11 capture.
  const record = !!process.env.DISPLAY && process.env.XDG_SESSION_TYPE !== 'wayland'
  const path = info.outputPath('overlay-transitions.mkv')
  let recorder: ReturnType<typeof spawn> | undefined
  let stopped: Promise<void> | undefined
  if (record) {
    recorder = spawn('ffmpeg', ['-y', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '60',
      '-video_size', '1440x960', '-i', process.env.DISPLAY!, '-c:v', 'ffv1', path], { stdio: ['pipe', 'ignore', 'pipe'] })
    const recording = recorder
    stopped = new Promise<void>((resolve, reject) => {
      recording.once('exit', code => code === 0 ? resolve() : reject(new Error(`Recorder exited with ${code}`)))
      recording.once('error', reject)
    })
    await new Promise<void>((resolve, reject) => {
      recording.once('error', reject)
      recording.stderr!.on('data', chunk => { if (String(chunk).includes('frame=')) resolve() })
    })
  }
  try {
    for (let i = 0; i < 5; i++) {
      await page.getByRole('button', { name: 'Preview overlay.jpg' }).click()
      await expect(modal.locator('dialog[open] > img')).toBeVisible()
      await expect.poll(state).toBe(true)
      const media = await browser.locator('#overlay-video').evaluate((video: HTMLVideoElement) => ({ time: video.currentTime, paused: video.paused }))
      expect(media.paused).toBe(false)
      await expect.poll(() => browser.locator('#overlay-video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(media.time)
      await modal.getByRole('button', { name: 'Close image preview' }).click()
      await expect.poll(state).toBe(false)
      await expect(page.getByRole('button', { name: 'Preview overlay.jpg' })).toBeFocused()
    }
    await page.getByRole('button', { name: 'Capture', exact: true }).click()
    await expect(menu.getByRole('menu', { name: 'Capture', exact: true })).toBeVisible()
    // This is a real page click, not a synthetic replay through the overlay.
    await browser.getByRole('button', { name: 'Test button' }).click()
    await expect(browser.locator('#result')).toHaveText('Clicked successfully')
    await expect(menu.getByRole('menu')).toHaveCount(0)
    await page.locator('.picker-trigger').click()
    await expect(menu.getByRole('menu', { name: 'Providers', exact: true })).toBeVisible()
    await menu.keyboard.press('Escape')
    await expect(menu.getByRole('menu')).toHaveCount(0)
  } finally {
    recorder?.stdin?.write('q')
    await stopped
  }
  expect(await browser.evaluate(() => ({ href: location.href, scroll: scrollY, width: innerWidth, height: innerHeight }))).toEqual(before)
  await expect(browser.getByLabel('Test input')).toHaveValue('Preserve this form')
  if (record) {
    const marker = await browser.locator('#overlay-pixel-marker').boundingBox()
    const at = await app.evaluate(({ BrowserWindow, WebContentsView }, { origin, marker }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const view = win.contentView.children.find(v => v instanceof WebContentsView && (v as InstanceType<typeof WebContentsView>).webContents.getURL().startsWith(origin))!
      const b = view.getBounds(), w = win.getContentBounds()
      return { x: Math.round(w.x + b.x + marker!.x + 10), y: Math.round(w.y + b.y + marker!.y + 20) }
    }, { origin: rocket.origin, marker })
    const { stdout } = await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', path, '-vf', `crop=41:1:${at.x}:${at.y}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
    const frames = stdout.length / (41 * 3)
    expect(frames).toBeGreaterThan(60)
    const bad: number[] = []
    for (let frame = 0; frame < frames; frame++) {
      const pixel = (x: number) => [...stdout.subarray(frame * 123 + x * 3, frame * 123 + x * 3 + 3)]
      const [g, m, b] = [pixel(0), pixel(20), pixel(40)]
      // A modal may dim the page. The three original colors must remain present in every frame.
      if (!(g[1] >= 45 && g[0] <= 4 && g[2] <= 4 && m[0] >= 45 && m[2] >= 45 && m[1] <= 4 && b[2] >= 45 && b[0] <= 4 && b[1] <= 4)) bad.push(frame)
    }
    await info.attach('Composed overlay transitions at 60 fps', { path, contentType: 'video/x-matroska' })
    expect(bad, `No blank or replacement page pixels in ${frames} composed frames`).toEqual([])
  }
})

test('website select popups at a nonzero browser offset retain the page', async ({ rocket }) => {
  const { page } = rocket
  await (await section(page, 'Browser')).click()
  const browser = await rocket.surface('browser')
  await expect(browser.getByRole('heading', { name: 'Rocket browser check' })).toBeVisible()
  await browser.evaluate(() => {
    const select = document.createElement('select')
    select.id = 'native-select'
    select.setAttribute('aria-label', 'Native categories')
    select.style.cssText = 'position:fixed;left:180px;top:180px;width:220px;height:40px;font:20px sans-serif'
    for (const label of ['All categories', 'Accessibility', 'Design and development']) {
      const option = document.createElement('option')
      option.textContent = label
      select.append(option)
    }
    document.body.append(select)
  })
  await browser.getByLabel('Native categories').click()
  // Native popup painting is asynchronous and is not exposed in the page DOM.
  await page.waitForTimeout(250)
  await rocket.capture('website-native-select-offset')
  await browser.keyboard.press('ArrowDown')
  await browser.keyboard.press('Enter')
  await expect(browser.getByLabel('Native categories')).toHaveValue('Accessibility')
})
