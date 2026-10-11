import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
const db = new DatabaseSync(join(homedir(), '.config', 'Rocket', 'rocket.db'), { readOnly: true })
const f = (t) => (t ? new Date(t).toISOString() : null)
const turn = db.prepare("select * from turns where id like '3b7980ce%'").get()
console.log('turn', turn.id.slice(0,8), turn.provider, turn.status, 'seq', turn.seq, 'ended', f(turn.ended_at), 'changes', turn.changes)
console.log('sessions for chat', db.prepare('select provider, session_id, seen_turn_seq from provider_sessions where chat_id = ?').all(turn.chat_id))
console.log('later turns in chat', db.prepare('select provider, status, seq, started_at from turns where chat_id = ? and seq > ? order by seq').all(turn.chat_id, turn.seq).map(r => [r.provider, r.status, r.seq, f(r.started_at)]))
console.log('turn_patches row exists', !!db.prepare('select turn_id from turn_patches where turn_id = ?').get(turn.id))
console.log('schema provider_sessions', db.prepare("select sql from sqlite_master where name='provider_sessions'").get().sql)
console.log('app_flags', db.prepare('select * from app_flags').all())
