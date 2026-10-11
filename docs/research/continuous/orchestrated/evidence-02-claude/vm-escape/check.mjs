import vm from 'node:vm'
import { Worker } from 'node:worker_threads'
const out = { node: process.version }
const ctx = vm.createContext(Object.freeze(Object.create(null)))
try {
  const r = vm.runInContext(`(() => { const F = ({}).constructor.constructor; return F('return typeof process')() })()`, ctx, { timeout: 1000 })
  out.frozenVmContext = { escapedToOuterRealm: r === 'object', typeofProcess: r }
} catch (e) { out.frozenVmContext = { escapedToOuterRealm: false, error: String(e) } }
const w = new Worker(new URL('./worker-side.mjs', import.meta.url))
w.on('message', m => { out.workerWithoutParentPortInScope = m; console.log(JSON.stringify(out, null, 2)); w.terminate() })
