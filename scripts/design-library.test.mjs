import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, validateLibrary } from './design-library.mjs'

test('library add and edit preserve other references and reject invalid writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'rocket-design-'))
  try {
    mkdirSync(join(root, 'references'))
    writeFileSync(join(root, 'references/note.md'), '# Reference')
    writeFileSync(join(root, 'index.json'), JSON.stringify({ version: 1, references: [] }))
    const entry = { id: 'first', title: 'First', summary: 'Useful tables', surface: 'app', verticals: ['finance'], patterns: ['table'], character: ['light'], status: 'candidate', sources: ['https://example.com'], notes: 'references/note.md', images: [] }
    const input = join(root, 'input.json')
    const write = value => writeFileSync(input, JSON.stringify(value))
    write(entry)
    assert.match(run(['add', input], root), /Added first/)
    assert.throws(() => run(['add', input], root), /Already exists/)
    write({ ...entry, id: 'second' })
    run(['add', input], root)
    write({ ...entry, title: 'Updated', status: 'reviewed' })
    run(['edit', input], root)
    assert.match(run(['list', 'finance'], root), /Updated/)
    const before = readFileSync(join(root, 'index.json'), 'utf8')
    assert.equal(JSON.parse(before).references[1].id, 'second')
    write({ ...entry, images: [{ path: 'missing.png', source: 'https://example.com/image', caption: 'Missing', savedAt: '2026-10-05' }] })
    assert.throws(() => run(['edit', input], root), /Missing file/)
    assert.equal(readFileSync(join(root, 'index.json'), 'utf8'), before)
    assert.throws(() => validateLibrary({ version: 1, references: [entry, entry] }, root), /Duplicate/)
    assert.throws(() => validateLibrary({ version: 1, references: [{ ...entry, sources: ['file:///tmp/image'] }] }, root), /HTTP/)
    assert.match(run(['validate'], root), /2 references/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
