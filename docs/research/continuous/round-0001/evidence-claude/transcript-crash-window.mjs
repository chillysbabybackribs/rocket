// Read-only look at the transcript around the 2026-10-06 11:00 EDT machine crash and at turn
// statuses overall. Opens rocket.db read-only; writes nothing.
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
const db = new DatabaseSync(join(homedir(), '.config', 'Rocket', 'rocket.db'), { readOnly: true })
const f = (t) => (t ? new Date(t).toISOString() : null)
console.log('tables', db.prepare("select name from sqlite_master where type='table'").all().map(r => r.name).join(', '))
console.log('turns by status', db.prepare('select status, count(*) n from turns group by status').all())
console.log('turns by provider', db.prepare('select provider, count(*) n from turns group by provider').all())
const crash = Date.parse('2026-10-06T15:00:15Z') // 11:00:15 EDT
const rows = db.prepare('select id, chat_id, provider, status, started_at, ended_at, error from turns where started_at between ? and ? or ended_at between ? and ? order by started_at').all(crash - 90*60_000, crash + 60_000, crash - 60_000, Date.parse('2026-10-07T18:30:00Z'))
for (const r of rows) console.log(r.provider, r.status, 'started', f(r.started_at), 'ended', f(r.ended_at), (r.error || '').slice(0, 80), r.id.slice(0, 8))
console.log('interrupted turns whose ended_at is >1h after started_at (crash-cut candidates):')
for (const r of db.prepare("select id, provider, started_at, ended_at from turns where status='interrupted' and ended_at - started_at > 3600000 order by started_at").all()) console.log(' ', r.provider, f(r.started_at), '->', f(r.ended_at))
console.log('sessions', db.prepare('select provider, count(*) n, sum(session_id is null) lost from sessions group by provider').all())
const last = db.prepare('select max(started_at) t from turns').get(); console.log('newest turn', f(last.t))
