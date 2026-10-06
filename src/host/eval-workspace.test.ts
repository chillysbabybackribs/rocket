import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeWorkspace, workspaceChanges } from './eval-workspace.ts'

test('a run copy reports the files the turn changed, added and deleted, with repo-relative paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'rocket-eval-ws-'))
  try {
    const source = join(root, 'fixture')
    mkdirSync(join(source, 'docs'), { recursive: true })
    mkdirSync(join(source, 'node_modules'))
    writeFileSync(join(source, 'README.md'), 'one\ntwo\n')
    writeFileSync(join(source, 'docs', 'old.md'), 'gone\n')
    writeFileSync(join(source, 'node_modules', 'big.js'), 'skipped\n')

    const workspace = makeWorkspace(source, join(root, 'run'))
    assert.deepEqual(workspaceChanges(workspace), { patch: '', files: [] })

    writeFileSync(join(workspace.work, 'README.md'), 'one\ntwo\nthree\n')
    writeFileSync(join(workspace.work, 'NEW.md'), 'hello\n')
    rmSync(join(workspace.work, 'docs', 'old.md'))
    const { patch, files } = workspaceChanges(workspace)
    assert.deepEqual(files.sort((a, b) => (a.path < b.path ? -1 : 1)), [
      { path: 'NEW.md', added: 1, removed: 0 },
      { path: 'README.md', added: 1, removed: 0 },
      { path: 'docs/old.md', added: 0, removed: 1 }
    ])
    assert.ok(patch.includes('diff --git a/README.md b/README.md'))
    assert.ok(!patch.includes('before/') && !patch.includes('work/'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a scenario folder that does not exist is refused with what to fix', () => {
  assert.throws(() => makeWorkspace('/nonexistent/rocket-fixture', join(tmpdir(), 'unused')), /Fix its cwd/)
})
