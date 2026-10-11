# Agent evals — research for Rocket

*Research summary, October 2026. How evals work, what teams use, and how Rocket can apply them.*

---

## How evals work

An **eval** is a fixed **input** → agent runs in an **environment** → **graders** score the **outcome** and/or **transcript** (tool calls, turns, latency, cost).

| Layer | What you measure | Typical graders |
|-------|------------------|-----------------|
| **Outcome** | Final world state (tests pass, UI state, files, DB) | Unit tests, Playwright, static analysis |
| **Trajectory** | Steps taken (tools, order, loops, recovery) | Trace rules, max steps, required/forbidden tools |
| **Quality (subjective)** | Design, tone, groundedness | Rubric LLM-as-judge, **pairwise** A/B, human calibration |

### Two suite types

- **Capability evals** — “Can we do this at all?” Low pass rate; you hill-climb.
- **Regression evals** — “Did we break what worked?” Target ~100% pass; CI gates.

Agents are stochastic: run **multiple trials** per task and compare **distributions**, not one lucky pass.

### Offline vs online

- **Offline** — Resettable environment, controlled dependencies, batch runs before merge.
- **Online** — Sample production traces, user feedback, convert failures into new regression cases (the eval flywheel).

### Harness vs model

For coding and desktop agents, evaluate the **harness–model pair**, not the model alone. Harness choice can swing pass rate, cost, and latency dramatically while pass rates stay within a few points ([Scaffold Effect](https://kdd-eval-workshop.github.io/agenticai-evaluation-kdd2026/assets/papers/74_The_Scaffold_Effect_in_Codi.pdf), [Harness or Model?](https://arxiv.org/abs/2609.11987)).

Google’s [harness engineering](https://developers.googleblog.com/en/the-anatomy-of-harness-engineering-how-to-evaluate-iterate-and-guard-ai-coding-agents/) post argues **behavioral micro-evals** (integration-test style) complement big benchmarks—they explain *why* a change moved and catch regressions prompts alone won’t.

**Primary reference:** [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) (Anthropic, Jan 2026).

---

## Who does evals well (practitioner view)

| Approach | Best for | Strengths | Caveats |
|----------|----------|-----------|---------|
| **Braintrust** + **autoevals** | Teams wanting experiments + traces + CI | Datasets, side-by-side runs, code + LLM scorers; [autoevals](https://github.com/braintrustdata/autoevals) works without the hosted platform | Scorer design is still on you; self-host is enterprise |
| **LangSmith** | LangChain / LangGraph stacks | Traces, offline pytest evals, online judges, judge calibration | Strong observability; less “regression harness” than pre-deploy gate ([custom harness essay](https://tanayshah.dev/blog/building-my-own-agent-eval-harness/)) |
| **Promptfoo** | YAML/config evals + red teaming | Fast iteration, assertions, adversarial suites | Wire a custom provider for Electron/desktop |
| **Harbor / Terminal-Bench** | Research & public benchmarks | Containerized tasks, standard graders | Heavy; not a substitute for *your* product regressions |
| **Custom harness** | Clean-room fixtures, baseline vs candidate | Held-out graders, isolation, cost telemetry ([example](https://github.com/zackproser/coding-agent-eval-harness)) | You own maintenance—often preferred for pre-deploy regression |

### Themes practitioners repeat

- Pin **model + prompt + tool schema** in CI.
- Never let one vague “helpfulness” score own a write-capable agent.
- Calibrate LLM judges on a **frozen human set**; one dimension per judge call.
- Prefer **outcome oracles** and **rubric dimensions** over single 1–10 scores.
- Use **pairwise** comparisons when choosing variants (see `docs/research/agent-design-quality.md`).

---

## What Rocket already has

Rocket is closer to a **purpose-built harness** than a generic chat shell.

| Layer | Mechanism |
|-------|-----------|
| **L0 Unit** | `npm test` — host, goals, handoff, providers, scripts |
| **L1 UI regression** | `npm run check:ui` — isolated profile, `UiTestAdapter`, Playwright in `tests/ui/` |
| **Agent UI scripts** | `rocket_ui_run` — isolated Electron + Playwright-shaped API |
| **Live smoke** | `npm run check:live` — real CLIs (complements controlled UI) |
| **Runtime telemetry** | `journal.jsonl`, `rocket_diagnostics`, turn timing |
| **End-to-end product eval** | **Goals** — worker + **second provider as checker** with evidence per checklist line (`docs/goals-phase1.md`) |
| **Design evidence** | Design library + `agent-design-quality.md` (vision critic, pairwise, keep-best revision) |

That matches the recommended split: **micro behavioral tests for the harness** + **macro task checks** where “done” is defined.

---

## Recommended next steps (ordered)

### 1. Name the eval layers

Document L0–L4 in-repo (README or `docs/evals.md`):

- **L0** — unit  
- **L1** — UI regression (`check:ui`, ~100% pass)  
- **L2** — optional provider matrix (nightly)  
- **L3** — goal / design capability scenarios  
- **L4** — online: journal + user “wrong turn” → new L1/L3 case  

Extend UI check `summary.json` with duration, flake count, git SHA for trends.

### 2. Harden `check:ui` as the regression spine

- Document `--repeat-each=3` as the flake budget.  
- Add a **capability** spec folder for in-progress features; **graduate** to regression when stable.

### 3. Export transcripts for graders

For eval runs, write redacted **JSONL traces** (provider, model, tools, items, journal timing). Enables:

- “Must call `goal_report` before claiming done”  
- Trajectory checks (steer honored, no replan loops)

### 4. Held-out UI graders via `rocket_ui_run`

Keep the rule: **inspect DOM, don’t mutate state to pass**. Post-conditions asserted by Playwright/worker **after** `ui.release()`—same pattern as held-out tests in coding eval harnesses.

### 5. Goal + design capability evals (differentiator)

| Task | Grader |
|------|--------|
| Brief completeness | `goal_report` schema |
| Preparation skill | Multi-dimension rubric on draft (not one score) |
| Checker | Synthetic workspaces with known pass/fail oracle |
| UI goals | `rocket_ui_run` + vision critic loop from design research |

Use **pairwise** comparison for GoalDesign variants.

### 6. Provider matrix (weekly, not every PR)

Same L3 goal across Codex / Claude / Cursor / Antigravity; metrics: checklist pass, turns, journal timing, usage cost. Report **pairs**, not a single “best model.”

### 7. When to adopt a vendor platform

- **Stay DIY** for L0–L2 (isolation + Playwright + controlled adapters).  
- **autoevals (npm)** only if you want maintained judge prompts for L3 rubrics.  
- **Braintrust / LangSmith** when you need **high-volume online scoring** and annotation queues—not for Electron UI regressions.

### 8. Model behavior inside the app

- Journal spike checks after registry/prompt changes.  
- Extend steer specs per `PROVIDERS` flags.  
- Golden handoff transcripts: checker must see worker edits.

---

## Summary

Evals separate **outcome**, **trajectory**, and **rubric quality**; **regression** suites in CI use multiple trials; production failures feed the suite.

Opinion leaders cluster around **Braintrust**, **LangSmith**, **Promptfoo**, and **custom harnesses**—with growing emphasis that **the harness is half the score**.

Rocket’s highest leverage is not “install a platform,” but **document layers, export transcripts, add goal/design capability evals**, and treat **`check:ui` + goal oracles** as the regression spine.

---

## Links

- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)  
- [Braintrust autoevals](https://github.com/braintrustdata/autoevals)  
- [Google — Harness engineering](https://developers.googleblog.com/en/the-anatomy-of-harness-engineering-how-to-evaluate-iterate-and-guard-ai-coding-agents/)  
- [Tanay Shah — Build your own eval harness](https://tanayshah.dev/blog/building-my-own-agent-eval-harness/)  
- Rocket: `docs/research/agent-design-quality.md`, `docs/goals-phase1.md`, `README.md` (Tools, self-check, `check:ui`)
