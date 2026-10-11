// Minimal mirror of Rocket's startup order (src/main/index.ts lines 31-37 and 288-300):
// userData set, remote-debugging switches appended, THEN requestSingleInstanceLock.
// EXP_ORDER=lock-first flips it: lock is requested before the switch is appended (the proposed fix).
const { app } = require('electron')
const fs = require('node:fs'), path = require('node:path')
const userData = process.env.EXP_USER_DATA, role = process.env.EXP_ROLE, port = process.env.EXP_PORT
const order = process.env.EXP_ORDER || 'rocket'
app.setPath('userData', userData)
const file = path.join(userData, 'DevToolsActivePort')
const read = () => { try { return JSON.stringify(fs.readFileSync(file, 'utf8')) } catch (e) { return `<${e.code}>` } }
const log = (m) => fs.appendFileSync(path.join(userData, `log-${role}.txt`), `${new Date().toISOString()} pid=${process.pid} ${m} file=${read()}\n`)
log(`start order=${order} port=${port}`)
const addSwitches = () => { app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1'); app.commandLine.appendSwitch('remote-debugging-port', String(port)); log('switches appended') }
if (order === 'rocket') addSwitches()
const won = app.requestSingleInstanceLock()
log(won ? 'lock won' : 'lock lost')
if (order === 'lock-first' && won) addSwitches()
if (!won) app.quit()
else app.on('second-instance', (_e, argv) => log(`second-instance ${JSON.stringify(argv.slice(-1))}`))
app.on('ready', () => log('ready'))
app.on('will-quit', () => log('will-quit'))
app.on('quit', (_e, code) => log(`quit code=${code}`))
if (won) app.whenReady().then(() => { setInterval(() => log('alive'), 2000).unref(); setTimeout(() => {}, 1 << 30) })
