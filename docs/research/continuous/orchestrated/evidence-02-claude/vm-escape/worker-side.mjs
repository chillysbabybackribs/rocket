import { parentPort } from 'node:worker_threads'
// Mirror ui-run-worker.mjs: the model's code only gets named parameters; `parentPort` is a module
// binding the function body cannot see by name.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const code = `const wt = await import('node:worker_threads'); const fs = await import('node:fs'); return { parentPortViaImport: !!wt.parentPort, readdirRootWorks: Array.isArray(fs.readdirSync('/')), typeofProcess: typeof process }`
const result = await new AsyncFunction('page', 'ui', code)(null, null)
parentPort.postMessage(result)
