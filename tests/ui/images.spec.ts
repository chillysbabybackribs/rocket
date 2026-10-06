import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test, expect } from './app'
import { jpegBase64 } from '../fixtures/image'

const small = { name: 'clipboard.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegBase64, 'base64') }

test('image uploads, queue editing, Stop and restart preserve the whole message', async ({ rocket }) => {
  let page = rocket.page
  await page.locator('.composer-folder').click()
  const choice = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Attach images', exact: true }).click()
  await (await choice).setFiles(resolve('docs/mockups/image-attachments-assets/rocket.png'))
  await expect(page.locator('.is-draft .image-thumbnail img')).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Compare this screen')
  await rocket.capture('images-draft')
  await rocket.restart()
  page = rocket.page
  await expect(page.locator('.is-draft .image-thumbnail img')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Compare this screen')
  await page.getByRole('button', { name: 'Show browser', exact: true }).click()
  await page.getByRole('button', { name: 'Preview rocket.png' }).click()
  await expect(page.locator('dialog[open] > img')).toBeVisible()
  await rocket.capture('images-preview-with-browser')
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Hide browser', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('UI check: stream')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.prose')).toContainText('Streaming from claude.')
  await expect(page.locator('.user-message > .image-attachments .image-thumbnail')).toHaveCount(1)
  await expect(page.locator('.user-bubble .image-thumbnail')).toHaveCount(0)
  await expect(page.locator('.user-message > .user-bubble')).toHaveText('UI check: stream')
  await rocket.capture('images-separate-prompt')
  await page.locator('.image-file-input').setInputFiles(small)
  await expect(page.locator('.is-draft .image-thumbnail')).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this reference too')
  await page.getByRole('button', { name: 'Send when the turn ends', exact: true }).click()
  await expect(page.locator('.steer.is-waiting .image-thumbnail')).toHaveCount(1)
  await page.locator('.steer.is-waiting').getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this reference too')
  await expect(page.locator('.is-draft .image-thumbnail')).toHaveCount(1)
  await page.getByRole('button', { name: 'Send when the turn ends', exact: true }).click()
  await expect(page.locator('.steer.is-waiting .image-thumbnail')).toHaveCount(1)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.locator('.steer.is-waiting')).toHaveCount(0)
  await expect(page.locator('.is-draft .image-thumbnail')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this reference too')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
  // Image-only messages need no invented user text.
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.prose').last()).toHaveText('Received 1 image(s).')
  await rocket.restart()
  page = rocket.page
  await expect(page.locator('.user-message > .image-attachments .image-thumbnail img')).toHaveCount(2)
  await page.getByRole('button', { name: 'Preview clipboard.jpg' }).click()
  await expect(page.locator('dialog[open] > img')).toBeVisible()
  await page.keyboard.press('Escape')
  const request = JSON.parse(await readFile(join(rocket.profile, 'ui-request.json'), 'utf8'))
  expect(request.attachments[0].name).toBe('clipboard.jpg')
  expect(await readFile(request.attachments[0].path)).toEqual(small.buffer)
  await rocket.capture('images-sent-after-restart')
})

test('paste and drop target the right pane, reject invalid files and retain unsupported drafts', async ({ rocket }) => {
  const { page } = rocket
  await page.locator('.composer-folder').click()
  await page.getByRole('button', { name: 'Add a chat beside this one', exact: true }).click()
  const first = page.locator('.pane').nth(0)
  const second = page.locator('.pane').nth(1)
  const data = await page.evaluateHandle(base64 => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'dropped.jpg', { type: 'image/jpeg' }))
    return transfer
  }, jpegBase64)
  await second.dispatchEvent('dragover', { dataTransfer: data })
  await expect(second.locator('.image-drop-target')).toBeVisible()
  await expect(first.locator('.image-drop-target')).toHaveCount(0)
  await rocket.capture('images-drop-second-pane')
  await second.dispatchEvent('drop', { dataTransfer: data })
  await expect(second.locator('.is-draft .image-thumbnail')).toHaveCount(1)
  await expect(first.locator('.is-draft .image-thumbnail')).toHaveCount(0)
  await first.getByRole('textbox', { name: 'Message', exact: true }).evaluate((input, base64) => {
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'pasted.jpg', { type: 'image/jpeg' }))
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, jpegBase64)
  await expect(first.locator('.is-draft .image-thumbnail')).toHaveCount(1)
  await first.locator('.image-file-input').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
  await expect(first.getByRole('alert')).toContainText('Choose a PNG')
  await first.getByRole('textbox', { name: 'Message', exact: true }).press('Control+4')
  // Clear the import error, leaving the provider limitation visible.
  await first.getByRole('button', { name: 'Remove pasted.jpg' }).click()
  await first.locator('.image-file-input').setInputFiles(small)
  await expect(first.getByRole('alert')).toContainText('Antigravity cannot receive images')
  await expect(first.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await first.getByRole('textbox', { name: 'Message', exact: true }).press('Control+2')
  await expect(first.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await rocket.capture('images-split-drafts')
})

test('queued images survive shutdown and can be sent after reopening', async ({ rocket }) => {
  let page = rocket.page
  await page.locator('.composer-folder').click()
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('UI check: stream')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.prose')).toContainText('Streaming from claude.')
  await page.locator('.image-file-input').setInputFiles(small)
  await expect(page.locator('.is-draft .image-thumbnail')).toHaveCount(1)
  await page.getByRole('button', { name: 'Send when the turn ends', exact: true }).click()
  await expect(page.locator('.steer.is-waiting .image-thumbnail')).toHaveCount(1)
  await rocket.restart()
  page = rocket.page
  await expect(page.locator('.steer.is-waiting .image-thumbnail')).toHaveCount(1)
  await page.locator('.steer.is-waiting').getByRole('button', { name: 'Send now' }).click()
  await expect(page.locator('.steer.is-waiting')).toHaveCount(0)
  await expect(page.locator('.prose').last()).toHaveText('Received 1 image(s).')
})
