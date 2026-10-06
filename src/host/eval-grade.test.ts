import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gradeTurnExport } from './eval-grade.ts'

const turn = (items: unknown[], status = 'completed') => ({ turn: { id: 't1', status }, items, ledger: { calls: [] } })
const said = (text: string) => ({ type: 'assistant', id: 'a', turnId: 't1', text, streaming: false })

test('files_unchanged and only_files_changed read the files the run changed', () => {
  const body = turn([said('Done.')])
  assert.equal(gradeTurnExport(body, ['files_unchanged'], { files: [] }).allPass, true)
  const edited = gradeTurnExport(body, ['files_unchanged'], { files: [{ path: 'README.md' }] })
  assert.equal(edited.graders.files_unchanged!.metadata!.reason, 'changed README.md')

  const only = 'only_files_changed: CONTRIBUTING.md'
  assert.equal(gradeTurnExport(body, [only], { files: [{ path: 'CONTRIBUTING.md' }] }).allPass, true)
  assert.match(String(gradeTurnExport(body, [only], { files: [{ path: 'CONTRIBUTING.md' }, { path: 'README.md' }] }).graders[only]!.metadata!.reason), /also changed README.md/)
  assert.match(String(gradeTurnExport(body, [only], { files: [] }).graders[only]!.metadata!.reason), /changed nothing/)
})

test('a file grader on a turn with no record of its files fails with what to do', () => {
  const result = gradeTurnExport(turn([said('Done.')]), ['files_unchanged'])
  assert.match(String(result.graders.files_unchanged!.metadata!.reason), /eval panel/)
})

test('no_question_asked fails on ask_user or a reply that ends with a question', () => {
  assert.equal(gradeTurnExport(turn([said('Which note do you mean?'), said('I added it.')]), ['no_question_asked']).allPass, true)
  assert.equal(gradeTurnExport(turn([said('Which note do you mean?')]), ['no_question_asked']).allPass, false)
  assert.equal(gradeTurnExport(turn([{ type: 'question', id: 'q', turnId: 't1', text: 'Which?' }, said('Done.')]), ['no_question_asked']).allPass, false)
})
