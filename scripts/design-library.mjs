#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, realpathSync, renameSync, unlinkSync } from 'node:fs'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const defaultRoot = fileURLToPath(new URL('../design-library/', import.meta.url))
const fail = message => { throw new Error(message) }
export function validateLibrary(data, root) {
  if (data?.version !== 1 || !Array.isArray(data.references)) fail('Expected version: 1 and a references array.')
  const ids = new Set()
  const localFile = path => {
    if (typeof path !== 'string' || !path || isAbsolute(path)) fail(`Expected a relative file path: ${path}`)
    const target = resolve(root, path)
    if (!existsSync(target)) fail(`Missing file: ${path}`)
    const rel = relative(realpathSync(root), realpathSync(target))
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) fail(`File escapes library: ${path}`)
  }
  const url = value => {
    try { if (!['https:', 'http:'].includes(new URL(value).protocol)) throw new Error() }
    catch { fail(`Expected an HTTP(S) source URL: ${value}`) }
  }
  for (const entry of data.references) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id ?? '')) fail('Use a lowercase hyphenated reference id.')
    if (ids.has(entry.id)) fail(`Duplicate id: ${entry.id}`)
    ids.add(entry.id)
    for (const key of ['title', 'summary', 'surface']) if (typeof entry[key] !== 'string' || !entry[key].trim()) fail(`${entry.id}: missing ${key}`)
    for (const key of ['verticals', 'patterns', 'character']) {
      if (!Array.isArray(entry[key]) || !entry[key].length || entry[key].some(x => typeof x !== 'string' || !x.trim())) fail(`${entry.id}: ${key} needs text tags`)
    }
    if (!['candidate', 'reviewed', 'archived'].includes(entry.status)) fail(`${entry.id}: invalid status`)
    if (!Array.isArray(entry.sources) || !entry.sources.length) fail(`${entry.id}: add a source`)
    entry.sources.forEach(url)
    localFile(entry.notes)
    if (!Array.isArray(entry.images)) fail(`${entry.id}: images must be an array`)
    for (const image of entry.images) {
      localFile(image.path)
      url(image.source)
      if (!image.caption?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(image.savedAt ?? '')) fail(`${entry.id}: image needs caption and savedAt date`)
    }
  }
  return data
}
export function run(args, root = defaultRoot) {
  const [command = 'list', arg] = args
  const index = resolve(root, 'index.json')
  const data = validateLibrary(JSON.parse(readFileSync(index, 'utf8')), root)
  if (command === 'validate') return `Valid: ${data.references.length} references.`
  if (command === 'list') return data.references.filter(e => !arg || JSON.stringify(e).toLowerCase().includes(arg.toLowerCase())).map(e => `${e.id} [${e.status}] — ${e.title}\n  ${e.summary}\n  ${resolve(root, e.notes)}`).join('\n') || 'No matching references.'
  if (!['add', 'edit'].includes(command) || !arg) fail('Usage: npm run design -- list [search] | validate | add entry.json | edit entry.json')
  const entry = JSON.parse(readFileSync(resolve(arg), 'utf8'))
  const position = data.references.findIndex(e => e.id === entry.id)
  if (command === 'add' && position >= 0) fail(`Already exists: ${entry.id}. Use edit.`)
  if (command === 'edit' && position < 0) fail(`Unknown reference: ${entry.id}. Use add.`)
  if (position < 0) data.references.push(entry)
  else data.references[position] = entry
  validateLibrary(data, root)
  const temporary = resolve(dirname(index), `.index-${process.pid}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' })
    renameSync(temporary, index)
  } finally { if (existsSync(temporary)) unlinkSync(temporary) }
  return `${command === 'add' ? 'Added' : 'Updated'} ${entry.id}.`
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(run(process.argv.slice(2))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
