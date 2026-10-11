// Stays alive across stdin EOF. Models a provider child that does not treat a dead parent as a stop.
process.stdin.on('end', () => {})
process.stdin.resume()
setInterval(() => {}, 1_000)
