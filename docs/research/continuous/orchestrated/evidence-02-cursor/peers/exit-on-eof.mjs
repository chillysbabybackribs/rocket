// Exits when stdin closes. Models the idle-CLI behaviour reported for codex, cursor-agent and agy.
// An 'end' listener alone leaves stdin paused and never fires; resume() makes it read.
process.stdin.on('end', () => process.exit(0))
process.stdin.resume()
setInterval(() => {}, 1_000)
