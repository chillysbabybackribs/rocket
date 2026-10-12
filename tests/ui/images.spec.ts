import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { overlay, test, expect, chatHistory, section } from './app'
import { jpegBase64 } from '../fixtures/image'
import { pdfBytes } from '../fixtures/pdf'

const small = { name: 'clipboard.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegBase64, 'base64') }

test('image uploads, queue editing, Stop and restart preserve the whole message', async ({ rocket }) => {
  let page = rocket.page
  await page.locator('.composer-folder').click()
  const choice = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Attach files', exact: true }).click()
  await (await choice).setFiles(resolve('docs/mockups/image-attachments-assets/rocket.png'))
  await expect(page.locator('.is-draft .image-thumbnail img')).toHaveCount(1)
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Compare this screen')
  await rocket.capture('images-draft')
  await rocket.restart()
  page = rocket.page
  await expect(page.locator('.is-draft .image-thumbnail img')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Compare this screen')
  await (await section(page, 'Browser')).click()
  await page.getByRole('button', { name: 'Preview rocket.png' }).click()
  await expect((await overlay(page, 'modal')).locator('dialog[open] > img')).toBeVisible()
  await rocket.capture('images-preview-with-browser')
  await (await overlay(page, 'modal')).keyboard.press('Escape')
  await expect((await overlay(page, 'modal')).locator('dialog[open]')).toHaveCount(0)
  await (await section(page, 'Browser')).click()
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
  await expect((await overlay(page, 'modal')).locator('dialog[open] > img')).toBeVisible()
  await (await overlay(page, 'modal')).keyboard.press('Escape')
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

test('PDF and code files attach beside images, preview in the side panel, and reach the provider as text after restart', async ({ rocket }) => {
  let page = rocket.page
  await page.locator('.composer-folder').click()
  const code = { name: 'invite.ts', mimeType: 'video/mp2t', buffer: Buffer.from('export async function inviteMember(email: string) {\n  return fetch(`/api/invites/${email}`)\n}\n') }
  await page.locator('.image-file-input').setInputFiles([{ name: 'onboarding-brief.pdf', mimeType: 'application/pdf', buffer: pdfBytes('Invite your first teammate') }, code, small])
  await expect(page.locator('.is-draft .file-attachment')).toHaveCount(2)
  await expect(page.locator('.is-draft .image-thumbnail img')).toHaveCount(1)
  await expect(page.locator('.is-draft .file-copy small').first()).toHaveText(/^PDF · 1 page · \d/)
  await page.getByRole('button', { name: 'Preview onboarding-brief.pdf' }).click()
  await expect(page.getByRole('region', { name: 'File preview' }).locator('.attachment-page')).toHaveCount(1)
  await page.getByRole('button', { name: 'Preview invite.ts' }).click()
  await expect(page.locator('.attachment-text')).toContainText('inviteMember')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Does this implementation cover the brief?')
  await rocket.capture('files-draft-preview')
  await page.locator('.image-file-input').setInputFiles({ name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]) })
  await expect(page.getByRole('alert')).toContainText('archive.zip is not an image, PDF or text file')
  await expect(page.locator('.is-draft .file-attachment')).toHaveCount(2)
  await page.getByRole('button', { name: 'Close artifact' }).click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.prose').last()).toHaveText('Received 1 image(s) and 2 file(s).')
  await expect(page.locator('.user-message > .image-attachments .file-attachment')).toHaveCount(2)
  await expect(page.locator('.user-message > .user-bubble')).toHaveText('Does this implementation cover the brief?')
  const request = JSON.parse(await readFile(join(rocket.profile, 'ui-request.json'), 'utf8'))
  expect(request.attachments.map((each: { kind: string }) => each.kind)).toEqual(['file', 'file', 'image'])
  expect(request.input).toContain('Invite your first teammate')
  expect(request.input).toContain('export async function inviteMember')
  await rocket.restart()
  page = rocket.page
  await expect(page.locator('.user-message > .image-attachments .file-attachment')).toHaveCount(2)
  await page.getByRole('button', { name: 'Preview onboarding-brief.pdf' }).click()
  await expect(page.locator('.attachment-page')).toHaveCount(1)
  await rocket.capture('files-sent-after-restart')
  // Antigravity takes files as text, so a file-only draft can be sent to it.
  await page.getByRole('button', { name: 'Close artifact' }).click()
  await page.locator('.image-file-input').setInputFiles(code)
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Control+4')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('an attachment is copied to another chat by menu or drag, saved, revealed, and outlives its source chat', async ({ rocket }) => {
  let page = rocket.page
  await page.locator('.composer-folder').click()
  const brief = pdfBytes('Invite your first teammate')
  await page.locator('.image-file-input').setInputFiles({ name: 'onboarding-brief.pdf', mimeType: 'application/pdf', buffer: brief })
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Here is the brief')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.prose').last()).toHaveText('Received 1 file(s).')
  await page.getByRole('button', { name: 'Add a chat beside this one', exact: true }).click()
  const source = page.locator('.pane').nth(0)
  const target = page.locator('.pane').nth(1)
  const sent = source.locator('.user-message .file-attachment')
  const draft = target.locator('.is-draft .file-attachment')
  const notice = (await overlay(page, 'notice')).locator('.attachment-notice')

  // Drag from the sent message onto the other pane: the drop target names the copy, and Undo takes it back.
  await sent.locator('.file-open').dragTo(target.locator('.composer'))
  await expect(draft).toHaveCount(1)
  await expect(notice).toContainText('Copied onboarding-brief.pdf to')
  await notice.getByRole('button', { name: 'Undo' }).click()
  await expect(draft).toHaveCount(0)

  // The ⋯ menu: Copy to chat lists the open panes, and copying keeps the destination's text.
  await target.getByRole('textbox', { name: 'Message', exact: true }).fill('Use the same brief here')
  await sent.hover()
  await source.getByRole('button', { name: 'More for onboarding-brief.pdf' }).click()
  await expect((await overlay(page, 'menu')).getByRole('menu', { name: 'onboarding-brief.pdf' })).toBeVisible()
  await rocket.capture('reuse-menu')
  await (await overlay(page, 'menu')).getByRole('menuitem', { name: 'Copy to chat' }).click()
  await expect((await overlay(page, 'menu')).locator('.attachment-chat').filter({ hasText: 'This chat' })).toHaveCount(1)
  await rocket.capture('reuse-picker')
  await (await overlay(page, 'menu')).locator('.attachment-chat').filter({ hasText: 'Pane 2' }).click()
  await expect(draft).toHaveCount(1)
  await expect(target.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Use the same brief here')
  await rocket.capture('reuse-copied')
  // Right-click opens the same menu; copying again says it is already there.
  await sent.click({ button: 'right' })
  await (await overlay(page, 'menu')).getByRole('menuitem', { name: 'Copy to chat' }).click()
  await (await overlay(page, 'menu')).locator('.attachment-chat').filter({ hasText: 'Pane 2' }).click()
  await expect(notice).toContainText('already in')
  await expect(draft).toHaveCount(1)

  // Save as writes the stored original; Reveal shows only Rocket's own copy.
  const saved = join(rocket.profile, 'saved-brief.pdf')
  await rocket.app.evaluate(({ dialog, shell }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as unknown as typeof dialog.showSaveDialog
    shell.showItemInFolder = (shown: string) => { (globalThis as { revealed?: string }).revealed = shown }
  }, saved)
  await sent.click({ button: 'right' })
  await (await overlay(page, 'menu')).getByRole('menuitem', { name: 'Save as…' }).click()
  await expect(notice).toContainText('Saved saved-brief.pdf')
  expect(await readFile(saved)).toEqual(brief)
  await sent.click({ button: 'right' })
  await (await overlay(page, 'menu')).getByRole('menuitem', { name: 'Reveal stored file' }).click()
  await expect(notice).toContainText('stored as')
  const revealed = await rocket.app.evaluate(() => (globalThis as { revealed?: string }).revealed)
  expect(revealed).toMatch(/[/\\]attachments[/\\][0-9a-f-]+\.pdf$/)

  // Deleting the chat the file came from leaves the copy usable, across a restart.
  page.once('dialog', dialog => void dialog.accept())
  await chatHistory(page).first().click()
  await (await overlay(page, 'menu')).locator('.chat-row').filter({ hasText: 'Here is the brief' }).hover()
  await (await overlay(page, 'menu')).getByRole('button', { name: 'Delete chat: Here is the brief' }).click()
  await rocket.restart()
  page = rocket.page
  const kept = page.locator('.is-draft .file-attachment')
  await expect(kept).toHaveCount(1)
  await kept.locator('.file-open').click()
  await expect(page.locator('.attachment-page')).toHaveCount(1)
  await rocket.capture('reuse-after-source-deleted')
})
