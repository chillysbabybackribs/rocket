import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

// Where PhotoCraft's web build is and which of its files a request may read, apart from the
// pane so they can be tested without Electron.

/** Where the web build is: ROCKET_PHOTOCRAFT_WEB, else the fork's usual dist/web. */
export function photocraftWebDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.ROCKET_PHOTOCRAFT_WEB || join(homedir(), 'src/photocraft/dist/web'))
}

/** A file under the build folder for a request path, or null when the path would leave it. */
export function staticFile(root: string, pathname: string): string | null {
  let path: string
  try { path = decodeURIComponent(pathname) } catch { return null }
  const file = resolve(root, `.${path === '/' ? '/index.html' : path}`)
  return file === root || file.startsWith(root + sep) ? file : null
}
