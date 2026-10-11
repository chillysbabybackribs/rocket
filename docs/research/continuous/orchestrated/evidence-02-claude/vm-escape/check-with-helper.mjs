// A vm context is only useful to Rocket if the script receives helpers (tab, page, ui). Any helper
// built outside the context is an outer-realm object, and its constructor chain is the outer Function.
import vm from 'node:vm'
const helper = { read: () => 'page text' }           // stands in for `tab` / `page`
const ctx = vm.createContext(Object.freeze({ page: helper }))
let result
try {
  result = vm.runInContext(`page.read.constructor('return typeof process + " " + process.pid')()`, ctx, { timeout: 1000 })
} catch (e) { result = `error: ${e}` }
console.log(JSON.stringify({ node: process.version, viaHelperConstructor: result, outerPid: process.pid }))
