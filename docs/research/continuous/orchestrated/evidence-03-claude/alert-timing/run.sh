#!/usr/bin/env bash
# Runs the page-effects fixture on the repo's Electron in a throwaway userData under /tmp, on a
# private Xvfb display so native dialogs can be photographed with ImageMagick's import.
set -u
cd "$(dirname "$0")"
ROOT=../../../../../..
ELECTRON=$ROOT/node_modules/.bin/electron
export ELECTRON_DISABLE_SANDBOX=1
unset ELECTRON_RUN_AS_NODE ELECTRON_EXEC_PATH ELECTRON_CLI_ARGS
UD=$(mktemp -d /tmp/rocket-exp3a-XXXX); echo "userData=$UD"
DISP=:95
Xvfb $DISP -screen 0 1280x900x24 >/dev/null 2>&1 &
XPID=$!
sleep 1
DISPLAY=$DISP EXP_USER_DATA=$UD timeout 150 "$ELECTRON" --no-sandbox main.cjs >"$UD/stdout.txt" 2>"$UD/stderr.txt"
echo "exit=$?"
kill $XPID 2>/dev/null
cp "$UD/results.json" results.json 2>/dev/null && echo "results.json copied"
cp "$UD"/*.png . 2>/dev/null
grep -c '\[result\]' "$UD/stdout.txt"; grep -i 'fatal' "$UD/stderr.txt" | head -5
echo "DONE $UD"
