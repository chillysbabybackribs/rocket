import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Chat, Item, Turn } from '../shared/types.ts'
import { Store } from './store.ts'
import { Teamwork, type Working } from './teamwork.ts'

/** A real repository in a temp folder, with one commit. */
function repo(): { dir: string; git: (...args: string[]) => string; write: (path: string, text: string) => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rocket-teamwork-')))
  const git = (...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
  const write = (path: string, text: string): void => writeFileSync(join(dir, path), text)
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.com')
  write('a.ts', 'a')
  write('b.ts', 'b')
  git('add', '-A')
  git('commit', '-q', '-m', 'start')
  return { dir, git, write }
}

function setup(dir: string) {
  const store = new Store(':memory:')
  const working: Working[] = []
  const warnings: string[] = []
  let clock = 1_000
  const changed: Turn[] = []
  const teamwork = new Teamwork(store, () => working, { commit: true, changed: (turn) => changed.push(turn), warn: (message) => warnings.push(message), now: () => clock })
  const chat = (id: string): Chat => {
    const made: Chat = { id, title: `chat ${id}`, cwd: dir, lastProvider: null, createdAt: 1, updatedAt: 1 }
    store.createChat(made)
    return made
  }
  /** Record a finished turn the way the hub would, and return it. */
  const turn = (chatId: string, provider: Turn['provider'], request: string, status: Turn['status'], edits: string[] = []): Turn => {
    clock += 10
    const id = `${chatId}-${clock}`
    const stored = store.createTurn({ id, chatId, provider, model: null, status, error: null, handoffTurns: 0, goalRole: null, changes: null, tokens: null, sources: null, startedAt: clock, endedAt: clock })
    const items: Item[] = [
      { type: 'user', id: `${id}:user`, turnId: id, text: request },
      ...edits.map((label, index): Item => ({ type: 'tool', id: `${id}:${index}`, turnId: id, kind: 'edit', label, status: 'done', output: '' }))
    ]
    for (const item of items) store.putItem(chatId, item)
    clock += 10
    return stored
  }
  return { store, working, warnings, changed, teamwork, chat, turn }
}

test('what a turn changed is kept with it as a patch, with totals on the turn, leaving out another running turn\'s file', async () => {
  const { dir, write } = repo()
  try {
    const { store, teamwork, working, changed, chat, turn } = setup(dir)
    chat('one')
    chat('two')
    await teamwork.context('one', 'claude', true)
    write('a.ts', 'line one\nline two\n')
    write('new.ts', 'fresh\n')
    write('b.ts', 'someone else is on this')
    working.push({ chatId: 'two', provider: 'codex', model: null, request: 'other work', edited: ['b.ts'] })
    const ended = turn('one', 'claude', 'Change a', 'completed')
    await teamwork.turnEnded(ended)
    assert.equal(changed.length, 1)
    assert.deepEqual(changed[0]!.changes, { files: 2, added: 3, removed: 1, undone: false })
    assert.equal(store.turn(ended.id)?.changes?.files, 2)
    const kept = store.turnPatch(ended.id)!
    assert.equal(kept.truncated, false)
    assert.match(kept.patch, /^diff --git a\/a\.ts b\/a\.ts/m)
    assert.match(kept.patch, /new file mode[\s\S]*\+fresh/)
    assert.doesNotMatch(kept.patch, /b\.ts/)
    assert.equal(store.turnPatch('no-such-turn'), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('undo puts a turn\'s files back, removes the ones it made, commits the reversal and marks the turn; a file changed since is named', async () => {
  const { dir, git, write } = repo()
  try {
    const { store, teamwork, working, changed, chat, turn } = setup(dir)
    chat('one')
    await teamwork.context('one', 'claude', true)
    write('a.ts', 'rewritten by the turn\n')
    write('new.ts', 'made by the turn\n')
    const ended = turn('one', 'claude', 'Rewrite a', 'completed')
    await teamwork.turnEnded(ended)
    assert.equal(git('log', '-1', '--format=%s'), 'Rewrite a')

    working.push({ chatId: 'one', provider: 'claude', model: null, request: 'more', edited: [] })
    assert.deepEqual(await teamwork.undoable(ended.id), { offered: false, reason: 'A turn is running in this folder.' })
    working.pop()
    assert.deepEqual(await teamwork.undoable(ended.id), { offered: true, reason: null })

    const undone = await teamwork.undo(ended.id)
    assert.equal(undone.changes?.undone, true)
    assert.equal(store.turn(ended.id)?.changes?.undone, true)
    assert.equal(changed.at(-1)?.id, ended.id)
    assert.equal(readFileSync(join(dir, 'a.ts'), 'utf8'), 'a', 'the file is as it was before the turn')
    assert.equal(existsSync(join(dir, 'new.ts')), false, 'the file the turn made is gone')
    assert.equal(git('log', '-1', '--format=%s'), 'Undo: Rewrite a')
    assert.match(git('log', '-1', '--format=%b'), /Undone by the user in Rocket/)
    assert.equal(git('status', '--porcelain'), '', 'the reversal is committed whole')
    assert.deepEqual(await teamwork.undoable(ended.id), { offered: false, reason: 'Already undone.' })
    await assert.rejects(teamwork.undo(ended.id), /Already undone/)

    // A second turn, then the user edits one of its files by hand: undo names the file and refuses.
    await teamwork.context('one', 'claude', false)
    write('a.ts', 'second rewrite\n')
    write('b.ts', 'second turn touched b\n')
    const second = turn('one', 'claude', 'Rewrite a and b', 'completed')
    await teamwork.turnEnded(second)
    write('b.ts', 'the user changed b afterwards\n')
    assert.deepEqual(await teamwork.undoable(second.id), { offered: false, reason: 'b.ts changed since.' })
    await assert.rejects(teamwork.undo(second.id), /b\.ts changed since/)
    assert.equal(readFileSync(join(dir, 'a.ts'), 'utf8'), 'second rewrite\n', 'nothing was touched')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a turn\'s changes are committed alone, under the request, and a stopped turn waits for the one that finishes it', async () => {
  const { dir, git, write } = repo()
  try {
    const { store, teamwork, chat, turn, warnings } = setup(dir)
    chat('one')
    write('b.ts', 'the user is halfway through this')
    const rules = await teamwork.context('one', 'claude', true)
    assert.match(rules!, /<git>[\s\S]*Do not stage, commit/)
    write('a.ts', 'changed by the turn')
    write('new file [1].ts', 'made by a shell command')
    await teamwork.turnEnded(turn('one', 'claude', 'Tidy the parser\nand more', 'interrupted'))
    assert.equal(git('log', '--format=%s'), 'start', 'a stopped turn commits nothing')

    assert.equal(await teamwork.context('one', 'claude', false), null, 'the rules are given once, and nothing else happened')
    assert.match((await teamwork.context('one', 'claude', true))!, /<git>/, 'a session started over is told again')
    const restarted = new Teamwork(store, () => [], { commit: true })
    assert.doesNotMatch(await restarted.context('one', 'claude', false) ?? '', /<git>/, 'a session resumed after a restart already has them')
    write('c.ts', 'c')
    await teamwork.turnEnded(turn('one', 'claude', 'Finish tidying', 'completed'))
    assert.equal(git('log', '-1', '--format=%s'), 'Finish tidying')
    assert.match(git('log', '-1', '--format=%b'), /Claude in Rocket, chat "chat one"\./)
    assert.deepEqual(git('show', '--name-only', '--format=').split('\n').sort(), ['a.ts', 'c.ts', 'new file [1].ts'])
    assert.equal(git('status', '--porcelain'), 'M b.ts', 'what the user had changed before the turn is left as it was')
    assert.deepEqual(warnings, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a model is told who is working in the folder, what other chats finished, and what changed under it', async () => {
  const { dir, write } = repo()
  try {
    const { teamwork, working, chat, turn } = setup(dir)
    chat('one')
    chat('two')
    await teamwork.context('one', 'claude', true)
    await teamwork.turnEnded(turn('one', 'claude', 'first', 'completed'))

    write('a.ts', 'edited in the other chat')
    await teamwork.context('two', 'codex', true)
    await teamwork.turnEnded(turn('two', 'codex', 'Rename the parser', 'completed', [join(dir, 'a.ts')]))
    write('b.ts', 'edited by hand')
    working.push({ chatId: 'two', provider: 'cursor', model: 'm2', request: 'Restyle the page', edited: ['styles.css'] })

    const told = (await teamwork.context('one', 'claude', false))!
    assert.match(told, /Working here right now:\n- Cursor \(m2\), asked "Restyle the page" and has edited styles\.css/)
    assert.match(told, /Finished here since your last turn, in other chats:\n- Codex, asked "Rename the parser" and edited a\.ts/)
    assert.match(told, /Changed since your last turn, by the user or something outside this chat: b\.ts/)
    assert.doesNotMatch(told, /<git>/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file another running turn has edited is left for that turn to commit', async () => {
  const { dir, git, write } = repo()
  try {
    const { teamwork, working, chat, turn } = setup(dir)
    chat('one')
    chat('two')
    await teamwork.context('one', 'claude', true)
    write('a.ts', 'mine')
    write('b.ts', 'theirs, still being worked on')
    working.push({ chatId: 'two', provider: 'codex', model: null, request: 'other work', edited: ['b.ts'] })
    await teamwork.turnEnded(turn('one', 'claude', 'My change', 'completed'))
    assert.equal(git('show', '--name-only', '--format='), 'a.ts')
    assert.equal(git('status', '--porcelain'), 'M b.ts')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
