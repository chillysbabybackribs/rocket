import { spawnSync } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parsePatch } from '../shared/patch.ts'

// Each eval run works in its own copy of the scenario's folder, kept in the profile and never in
// the repo, so runs side by side cannot touch each other, the user's work, or the app's commits
// of it. A second, untouched copy sits beside it; comparing the two after the turn says what the
// model changed, whether it edited through a tool or a shell command.

const SKIP = new Set(['.git', 'node_modules'])
const PATCH_LIMIT = 200_000

export type EvalWorkspace = { before: string; work: string }
export type EvalFileChange = { path: string; added: number; removed: number }

export function makeWorkspace(source: string, dir: string): EvalWorkspace {
  if (!existsSync(source)) throw new Error(`The scenario's folder ${source} does not exist. Fix its cwd in the scenario file.`)
  const before = join(dir, 'before')
  const work = join(dir, 'work')
  const filter = (path: string): boolean => !SKIP.has(basename(path))
  cpSync(source, before, { recursive: true, filter })
  cpSync(source, work, { recursive: true, filter })
  return { before, work }
}

/** What the turn changed in its copy: a unified diff with repo-relative paths, and per-file counts. */
export function workspaceChanges(workspace: EvalWorkspace): { patch: string; files: EvalFileChange[] } {
  const dir = join(workspace.before, '..')
  const result = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', 'before', 'work'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  })
  // git diff --no-index exits 1 when the folders differ; only an error or a higher code is a failure.
  if (result.error || (result.status ?? 2) > 1) throw new Error(`Could not compare the run's folder with the original: ${result.stderr || result.error?.message}`)
  // A deleted file is named from the original on both sides, an added one from the copy.
  const patch = (result.stdout ?? '').replace(/(^|\s)([ab])\/(?:before|work)\//gm, '$1$2/')
  const files = parsePatch(patch).map((file) => ({ path: file.path, added: file.added, removed: file.removed }))
  return { patch: patch.length > PATCH_LIMIT ? `${patch.slice(0, PATCH_LIMIT)}\n… diff cut at ${PATCH_LIMIT} characters\n` : patch, files }
}
