import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { oneLine } from './json.ts'

// The few things the app asks of git, so that models never have to: what a folder's files look
// like at a moment (a snapshot), what changed between two such moments, and a commit of exactly
// the files a turn changed. Snapshots are trees written through an index of the app's own, so
// the user's index, staged changes and branch are never touched by taking one.

const TIMEOUT_MS = 15_000
/** States in which a commit would land in the middle of something the user is doing by hand. */
const IN_PROGRESS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply']

function git(top: string, args: string[], options: { input?: string; env?: Record<string, string> } = {}): Promise<string> {
  return new Promise((done, fail) => {
    // Paths are passed as they are: a file named `a[1].ts` is that file, not a pattern.
    const child = execFile('git', ['--literal-pathspecs', '-C', top, ...args], {
      timeout: TIMEOUT_MS, maxBuffer: 32_000_000, env: { ...process.env, ...options.env }
    }, (error, stdout, stderr) => (error ? fail(new Error(oneLine(stderr || error.message, 300))) : done(stdout)))
    // A git that exits before reading its input reports why itself; the broken pipe adds nothing.
    child.stdin?.on('error', () => {})
    child.stdin?.end(options.input ?? '')
  })
}

const nul = (text: string): string[] => text.split('\0').filter(Boolean)

/** The top of the repository a folder is in, or null when it is in none. A home folder is never treated as a project. */
export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    const top = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
    return top && top !== homedir() ? top : null
  } catch {
    return null
  }
}

async function gitPath(top: string, name: string): Promise<string> {
  return resolve(top, (await git(top, ['rev-parse', '--git-path', name])).trim())
}

/** The working tree as it stands, as a tree id: every file git tracks or would track. Null when it cannot be taken. */
export async function snapshot(top: string): Promise<string | null> {
  try {
    // An index kept between snapshots, so only files that changed since the last one are read again.
    const index = await gitPath(top, 'rocket-index')
    if (!existsSync(index)) await copyFile(await gitPath(top, 'index'), index).catch(() => {})
    const env = { GIT_INDEX_FILE: index }
    await git(top, ['add', '-A'], { env })
    return (await git(top, ['write-tree'], { env })).trim() || null
  } catch {
    return null
  }
}

/** The files that differ between two snapshots, relative to the top. */
export async function changedBetween(top: string, before: string, after: string): Promise<string[]> {
  if (before === after) return []
  return nul(await git(top, ['diff', '--name-only', '-z', '--no-renames', before, after]))
}

/** How much of a turn's patch is kept; past this a turn has rewritten more than anyone reads in a panel. */
export const PATCH_LIMIT = 2_000_000

/** The unified diff of these files between two snapshots, cut to `PATCH_LIMIT` with `truncated` saying so. */
export async function patchBetween(top: string, before: string, after: string, paths: string[]): Promise<{ patch: string; truncated: boolean }> {
  if (before === after || !paths.length) return { patch: '', truncated: false }
  // `git diff` has no --pathspec-from-file; the paths go on the command line, literal under --literal-pathspecs.
  const text = await git(top, ['diff', '--no-color', '--no-renames', '--no-ext-diff', before, after, '--', ...paths])
  if (text.length <= PATCH_LIMIT) return { patch: text, truncated: false }
  // Cut at a file boundary, so what is shown is whole files.
  const cut = text.lastIndexOf('\ndiff --git ', PATCH_LIMIT)
  return { patch: text.slice(0, cut > 0 ? cut : PATCH_LIMIT), truncated: true }
}

/** Why a commit should not be made right now, or null when one can be. */
export async function commitBlocker(top: string): Promise<string | null> {
  for (const name of IN_PROGRESS) if (existsSync(await gitPath(top, name))) return `a ${name.replace(/_HEAD|_LOG/, '').toLowerCase()} is in progress`
  return git(top, ['symbolic-ref', '-q', 'HEAD']).then(() => null, () => 'HEAD is not on a branch')
}

/**
 * Commit these files, and only these, as they now stand: whatever else is changed or staged in
 * the repository is left exactly as it is. Returns the files committed, which is none when they
 * hold nothing new. Hooks are not run: this is the app keeping a record, not a person publishing.
 */
export async function commitPaths(top: string, paths: string[], message: string): Promise<string[]> {
  const wanted = new Set(paths)
  const status = nul(await git(top, ['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all']))
  const dirty = status.map((entry) => entry.slice(3)).filter((path) => wanted.has(path))
  if (!dirty.length) return []
  const input = dirty.join('\0')
  const fromInput = ['--pathspec-from-file=-', '--pathspec-file-nul']
  await git(top, ['add', '-A', ...fromInput], { input })
  await git(top, ['commit', '-q', '--no-verify', '-m', message, ...fromInput], { input })
  return dirty
}
