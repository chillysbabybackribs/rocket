import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { designPreparationContext } from './design-library.ts'

test('preparation discovers an editable library and tolerates unavailable resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'rocket-design-context-'))
  try {
    assert.equal(designPreparationContext(root), '')
    writeFileSync(join(root, 'index.json'), '{}')
    assert.equal(designPreparationContext(root), '')
    mkdirSync(join(root, 'skills/goal-preparation'), { recursive: true })
    writeFileSync(join(root, 'skills/goal-preparation/SKILL.md'), '# Prepare')
    const context = designPreparationContext(root)
    assert.ok(context.includes(join(root, 'index.json')))
    assert.ok(context.includes('DESIGN.md'))
    assert.ok(context.includes('nonvisual work does not need UI references'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
