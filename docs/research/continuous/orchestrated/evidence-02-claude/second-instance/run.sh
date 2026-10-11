#!/usr/bin/env bash
# Isolated reproduction: two Electron instances sharing one disposable userData directory, never Rocket's profile.
set -u
cd "$(dirname "$0")"
ROOT=../../../../../..
ELECTRON=$ROOT/node_modules/.bin/electron
export ELECTRON_DISABLE_SANDBOX=1
unset ELECTRON_RUN_AS_NODE ELECTRON_EXEC_PATH ELECTRON_CLI_ARGS
ORDER=${1:-rocket}
UD=$(mktemp -d /tmp/rocket-exp-XXXX); echo "userData=$UD order=$ORDER"
P1=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
P2=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
echo "P1=$P1 P2=$P2"
EXP_USER_DATA=$UD EXP_ROLE=a EXP_PORT=$P1 EXP_ORDER=$ORDER xvfb-run -a "$ELECTRON" --no-sandbox main.cjs >"$UD/stdout-a.txt" 2>&1 &
A=$!
for i in $(seq 1 60); do [ -s "$UD/DevToolsActivePort" ] && break; sleep 0.5; done
sleep 1
echo "--- after A up: DevToolsActivePort:"; cat "$UD/DevToolsActivePort"; echo
echo "--- /json/version on P1:"; curl -s --max-time 3 "http://127.0.0.1:$P1/json/version"; echo
echo "--- start B (same userData)"
EXP_USER_DATA=$UD EXP_ROLE=b EXP_PORT=$P2 EXP_ORDER=$ORDER xvfb-run -a "$ELECTRON" --no-sandbox main.cjs >"$UD/stdout-b.txt" 2>&1
echo "B exited with $?"
sleep 1
echo "--- after B exit: DevToolsActivePort:"; cat "$UD/DevToolsActivePort"; echo
echo "--- /json/version on P2 (B's port):"; curl -s --max-time 3 "http://127.0.0.1:$P2/json/version" || echo "curl failed (connection refused expected)"; echo
echo "--- /json/version on P1 (A's port):"; curl -s --max-time 3 "http://127.0.0.1:$P1/json/version"; echo
echo "--- logs"; cat "$UD"/log-*.txt
pkill -P $A 2>/dev/null; kill $A 2>/dev/null
for i in $(seq 1 20); do kill -0 $A 2>/dev/null || break; sleep 0.5; done
pkill -f "EXP_ROLE" 2>/dev/null; pkill -f "$UD" 2>/dev/null
sleep 1
echo "--- after A killed: file:"; cat "$UD/DevToolsActivePort" 2>&1; echo
echo "--- stdout a:"; head -20 "$UD/stdout-a.txt"; echo "--- stdout b:"; head -20 "$UD/stdout-b.txt"
echo "DONE $UD"
