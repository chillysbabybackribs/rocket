# Evidence for 02-claude-review-boundaries

Isolated, deterministic experiments. None touched Rocket's live profile or window; each Electron
run used a fresh `mktemp -d` userData under `/tmp` and its own `xvfb-run -a` display.

| Folder / file | What it shows | Rerun |
|---|---|---|
| `second-instance/` | Two Electron 44.5.1 instances sharing one userData. `run.sh rocket` mirrors Rocket's startup order (debug switches appended before `requestSingleInstanceLock`); `run.sh lock-first` is the proposed order. Results in `result-*.txt`, per-instance logs inline. | `./run.sh rocket`, `./run.sh lock-first` from that folder |
| `cookies/` | `ses.cookies.set` on Electron 44.5.1 / Chrome 152 for public-suffix Domain cookies (`.com`, `.co.uk`, `.ai`, `.github.io`) and host-only cookies for `com`, `github.io`. Result in `result.json`. | `EXP_USER_DATA=$(mktemp -d) xvfb-run -a node_modules/.bin/electron --no-sandbox cookies/main.cjs` |
| `vm-escape/` | Node 24.13.1: a frozen null-prototype `vm` context with no helpers resists the one-line `constructor.constructor` escape; a context given any helper object does not. The worker half shows that a function body without `parentPort` in scope gets it back with `import('node:worker_threads')` and has `fs`. | `node vm-escape/check.mjs`, `node vm-escape/check-with-helper.mjs` |
| `live-json-version.json` | One read-only `GET /json/version` on the live app's port (46303), to see which field names the app. | n/a |
| `electron-v44.5.1-devtools_manager_delegate.cc` | Electron v44.5.1 `shell/browser/ui/devtools_manager_delegate.cc`, fetched from raw.githubusercontent.com. Lines 67-83 and 97-102 are cited in the report. | n/a |
