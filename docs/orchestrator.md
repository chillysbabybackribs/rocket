# Continuous orchestration

**Status (2026-10-09): implemented.** Validated with controlled providers only; see Latest validation.

Ask a Rocket chat to continuously investigate or work on a task using the `orchestrator` tool. That chat owns the loop: it assigns focused work to fresh worker chats, reviews their reports, records what holds up, and uses the result to choose deeper work. The task determines whether implementation is authorized; a research task stays research.

The host keeps the loop alive across individual completed turns. It does not require one model response to remain open forever. There is no fixed round count. Up to three workers can run at once, with one active worker per provider within a run. Antigravity work is also held apart from other active Antigravity chats because its current tool connection has shared identity. All automatically dispatched turns use the provider's configured default model, including the orchestrator's continuation turns.

## What the user sees

Every run creates `docs/orchestrator/<run-id>/progress.md` in the chat's working folder. It contains:

- The original task and current status.
- A readable progress summary and the next question/action.
- A chronological checkpoint log.
- Worker assignments, chat IDs, report links, outcomes and the orchestrator's reviews.
- User updates sent in chat, and an editable **User notes** section.

Open the Markdown link to read progress beside the chat. A displayed progress file refreshes on orchestration events, including when opened through Library. Message the owning chat to redirect it, or edit the User notes section in the file. The host checks that section every two seconds and carries it into the next review. Notes are preserved when the generated sections are updated; keep the `<!-- rocket-orchestrator:user-notes -->` marker intact. Other generated sections are maintained by the tool.

The existing **Stop** button stays available while the loop waits for workers. It prevents new dispatch immediately and requests cancellation of the run's workers. A stop request is not treated as proof that the provider has stopped: unresolved workers remain marked running until their actual turn ends. Unrelated chats are not cancelled.

To finish current work gracefully, tell the orchestrator to wrap up. It calls `stop` with `drain: true`, lets current workers finish, writes one final review, and stops. It cannot dispatch new workers while draining.

## Tool actions

| Action | Arguments | Result |
| --- | --- | --- |
| `start` | `task` | Starts a run owned by the calling chat and returns its Markdown path. Use only for a user-requested continuous task. |
| `dispatch` | `provider`, `task` | Creates a fresh worker chat and assigns its report path. |
| `checkpoint` | `summary`, `next`; optionally `taskId`, `review` | Updates progress and records an evidence review for a finished worker. |
| `wait` | optional `seconds` (at most 25) | Waits for a progress change without busy polling. |
| `status` | none | Returns current state and recent pending work; the Markdown file holds the full history. |
| `stop` | optional `drain` (default true) | Stops dispatch; either finishes current workers and a final review, or requests worker cancellation. |
| `resume` | none | Explicitly resumes a paused/stopped run. |

The model should open each worker's report and inspect its evidence before checkpointing a review. A completed turn and a nonempty report are delivery checks, not a correctness verdict. Dispatch is held until finished tasks have a recorded review; the quality of that review still depends on the orchestrator inspecting the evidence. A completed worker without a readable report is marked failed. Provider errors and quota limits belong in progress, not hidden automatic retries.

## Recovery and limits

State is saved in the Rocket profile's `orchestrator.json`. After a host restart, active runs are paused and in-flight workers are marked interrupted; they do not silently resume spending usage. Ask the owning chat to inspect the saved work and resume.

A failed/interrupted orchestrator continuation pauses the loop. A continuation that ends without a progress checkpoint also pauses, rather than repeating empty turns or error prose forever. User notes remain on disk. Resume after resolving the problem. The tool does not bypass provider quotas, guarantee provider cancellation, or turn unlimited research into a promise of unlimited available service.

The first version keeps workers in ordinary chat history; it does not rearrange existing panes. They can be opened in panes using the usual chat controls. The Markdown file is the central progress view. The owning chat must have an identifiable tool connection; ambiguous shared-provider tool calls cannot start/control a run.

## Implementation and validation

- `src/host/orchestrator.ts`: persistent ownership, event-driven review scheduling, Markdown checkpoints and cancellation/drain state.
- `src/host/tools/orchestrator.ts`: one MCP tool, scoped to its calling chat.
- `src/shared/orchestrator.ts`: shared state types.
- `src/host/index.ts`: tool registration, turn/user-message/Stop integration.
- Renderer: existing Stop control remains enabled while an orchestration is active; progress previews refresh without navigating away.
- `src/host/orchestrator.test.ts`: controlled lifecycle and recovery tests.
- `tests/ui/orchestrator.spec.ts`: isolated desktop check of progress updates, user notes, default models, waiting-state Stop, worker cancellation and persistence.

Host changes require restarting Rocket to load the tool. Installing the code does not start a research loop. The previous session's external `scripts/research-loop.mjs` controller is separate and is not started or used by this tool.


Latest validation (2026-10-08): build/typecheck and all 256 tests passed (`npm test` on 2026-10-09 ran 257 tests, all passing); the isolated visible desktop run passed both orchestration and chat-link/artifact checks. Reports and captures are in `.artifacts/ui/2026-10-08T05-12-10-610Z-G4fNOd/`. These use controlled providers; a fresh live-provider orchestration has not been started with the new tool because the running host has not been restarted.
