# Rocket continuous research

This run investigates how to improve Rocket through repeated research, independent review, and synthesis across its four providers. It has no configured round, token, or total duration limit. Provider subscriptions, context windows, availability, disk space, and the running computer remain practical limits.

## Research cycle

1. All four providers inspect separate areas of the codebase, existing findings, tests, and primary documentation. Each reports evidence, uncertainty, proposed upgrades, and deeper questions.
2. All four providers review another provider's report. Review assignments rotate every round. Reviewers reopen sources, inspect implementation, and attempt to disprove important claims.
3. One provider synthesizes all eight reports into a cumulative upgrade backlog and new research assignments. The synthesizer rotates across providers.
4. The next research round follows the synthesis and unresolved questions. A finished report advances the cycle; it does not finish the research program.

Claude begins with architecture and provider lifecycle; Cursor with tools, browser reliability and security; Codex with evaluation and verification; Antigravity with product capabilities and context workflows. Synthesis can refine these assignments as evidence develops.

## Evidence standard

Every material finding needs code references or opened primary sources, a clear distinction between observation and inference, limitations, and a concrete way to verify the proposed improvement. Changing vendor facts must be researched again. Search snippets and agreement between models are not verification. Reviewers use stable claim IDs and classify findings as supported, contradicted, or unresolved.

Every round must explain what it adds or corrects. Do not repeat settled conclusions for volume. Follow unanswered questions, contradictions, implementation edge cases, or experiments with a clear expected information gain. Read prior reports directly; their complete text remains on disk across model context compaction.

Write reports under `docs/research/continuous/round-NNNN/`. A worker owns only its assigned report, JSON completion receipt, and evidence directory. The receipt records completion and follow-up questions; it does not certify correctness. The supervisor verifies that a completed turn wrote a matching receipt and a nonempty report before advancing. Semantic verification belongs to the separate review turn.

Research participants must not edit application source, dependencies, settings, controller files, or another participant's report. Read-only checks are allowed. Isolated experiments belong in the assigned evidence directory. Proposed implementation work goes in the synthesis backlog with acceptance checks. Do not manipulate the shared live app or start additional controllers.

## Operation

The external Node supervisor sends through the live Rocket composer and reads the transcript database in read-only mode. It runs independently of the initiating chat, with one active research turn per provider. Rocket must remain open and the four assigned panes must retain their chat and provider selections. The supervisor waits for any turn already running when it starts, including the initiating Codex turn.

```sh
node scripts/research-loop.mjs status
node scripts/research-loop.mjs pause
node scripts/research-loop.mjs resume
node scripts/research-loop.mjs stop
```

Pause prevents new dispatches while current turns finish. Stop prevents dispatches and stops identified research turns visible in their panes; it leaves Rocket open. Clicking Stop in a research pane pauses dispatch when the interrupted turn is observed. Resume explicitly permits continuing after interruption. Draft text, a changed pane/provider, or a new user turn holds dispatch for review instead of overwriting it. Stop/pause requests in a participant chat also instruct that participant to invoke the corresponding command.

Runtime state, task history, and supervisor logs live in `.artifacts/research-loop/`. Provider failures and missing receipts retry with increasing delays up to 30 minutes. There is no guaranteed automatic recovery from authentication or quota problems. An uncertain send is held for transcript inspection rather than blindly duplicated. A stopped computer does not auto-start the supervisor at login; use `resume` when Rocket is ready. No application restart is required to run this script.

Initial setup uses four panes ordered Claude, Cursor, Codex, Antigravity, then `node scripts/research-loop.mjs start`. A run already on disk uses `resume`. Model choices are selected from the live provider menus and retained in their panes.

## Findings during setup

The live UI tool initially attempted a refused connection using a stale `DevToolsActivePort` file. The running renderer identified port 46303; its `/json/version` response identified Rocket and supplied a working WebSocket endpoint. Updating the discovery file restored `rocket_ui_run` without restarting Rocket. Source investigation should examine `src/main/index.ts` and `src/main/ui-connection.ts` for a durable discovery fix.

The model picker in an upper pane placed some model entries above the visible pane where the title bar intercepted clicks. Activating the existing option with Enter succeeded. Include menu placement in the product/reliability investigation.
