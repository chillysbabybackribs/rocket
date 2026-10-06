# What makes coding agents design well (research, 2026-10-05)

Why goals produce competent but generic UIs (Orbit, Forma), and what has evidence of fixing it.
Four parallel research passes: systems and skills, user reports, papers and benchmarks, designer
workflows. [M] = measured result, [U] = strong user consensus, [O] = opinion or vendor claim.

## The cause

- **Distributional convergence / typicality bias.** With no direction, models sample the
  statistical centre of web design. Preference data rewards the familiar, so the centre is
  reinforced. [M] Verbalized Sampling, ICML 2026, https://arxiv.org/html/2510.01171v1 ;
  [O] https://claude.com/blog/improving-frontend-design-through-skills
- **Different models converge on the same output** ("Artificial Hivemind", NeurIPS 2025 best
  paper), so switching or mixing providers is not a diversity strategy. [M]
  https://neurips.cc/virtual/2025/poster/121421
- **AI prototypes score well on usability and neutral or negative on originality** (blind study,
  n=92). [M] https://arxiv.org/abs/2605.15124
- **Fixing the defaults makes new defaults.** The indigo/Inter look gave way to a second wave:
  cream, italic serif and terracotta; near-black with one acid accent; hairline "broadsheet"
  layouts. Anthropic's skill now names these by hex code. A static ban list goes stale. [U]
  https://letsdatascience.com/news/anthropics-claude-design-shapes-new-design-aesthetic-aaf43749
- **Scale.** 22% of about 1,590 Show HN pages carry 4 or more slop tells (333 points on HN). [M]
  https://www.adriankrebs.ch/blog/design-slop/

## What has evidence, strongest first

1. **A vision critic in the loop, scored on several dimensions** (render → screenshot → critique by
   a separate model with a rubric → revise; 2–3 cycles).
   - +10–18% overall, +18–26% on visual and aesthetic quality. The same loop without a critic
     gains only +1.5%. [M] Amazon, ICLR 2026 workshop:
     https://cdn.amazon.science/e2/87/68ecc1e04ecc9e2e92bcd5fd3750/scipub-approval152129-45356067-visionguided-iterative-refinement-for-frontend-code-generation.pdf
   - A judge scoring several dimensions matches human preference 69.5% of the time, against
     48.5% for a single overall score.
   - Plain "look at it again" self-revision does little (Design2Code). [M]
     https://arxiv.org/pdf/2403.03163
2. **Keep only revisions that score better, and return the best version, not the last.** This was
   the largest single gain in ReLook's ablation, and code quality drifts down across cycles
   otherwise. [M] https://arxiv.org/html/2510.11498v1
3. **Choose a direction before writing code, deliberately away from the typical.**
   - The model proposes several structured themes, each with a typicality score; one is sampled
     away from the typical; then the code is built.
   - Results: distinct themes per prompt rose from 1.0 to 2.1–2.9, screenshot similarity fell
     from 0.68 to 0.54, and negative user feedback fell 31.5% in a live A/B test on 310k tasks.
   - This is the only anti-sameness method with an A/B test. [M] Google:
     https://huggingface.co/papers/2609.15078
4. **When comparing variants, compare them pairwise, not by absolute score.** Pairwise judging
   recovers about 3x more of the best-of-N gain (61% vs 21%). [M]
   https://arxiv.org/abs/2603.12520
5. **Real visual references and a design-system file written before any screens.** This is the
   strongest user consensus.
   - [U] awesome-design-md, about 112k stars: https://github.com/voltagent/awesome-design-md
   - Reddit and HN: "give it good references, otherwise you get the same default everyone gets."
   - NN/g: richer inputs (sketches, mockups) clearly improve output; vague prompts fail.
     https://www.nngroup.com/articles/testing-ai-methodology
   - Reference images give fidelity to the reference, not originality. [M] Design2Code.
6. **Several variants, then pick and remix.** "Ask for ten options… one or two will be good."
   - [O] Nate Parrott, who built Claude Design:
     https://claude.com/blog/how-the-product-designer-who-built-claude-design-uses-it-to-explore-ideas-before-building-them
   - Superdesign runs up to 10 variants in parallel. [U] Reddit agrees.
7. **Named, maintained anti-tells.**
   - Anthropic frontend-design SKILL.md (current version names second-wave tells by hex),
     Impeccable (61 deterministic checks, `npx impeccable detect`), taste-skill.
   - Skill Arena puts these at the top, but with no no-skill baseline. [O]
     https://happycapy.ai/skill-arena/frontend-design ,
     https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md ,
     https://github.com/pbakaus/impeccable
   - Users say the skill alone still gives "mid" output. [U]
8. **Frame the problem as a designer would** (a named user, the one job the screen serves, real
   data with its edge cases) and design with real content, not lorem ipsum.
   - LLM mockups were only "partially" tailored to their personas. [M]
     https://arxiv.org/abs/2601.22759v1
   - Strong practitioner consensus, but no controlled study. [O]

## What does not work

- **Adjectives** ("modern, clean, premium", "make it look good"). [U]
- **A ban list on its own, or the official skill on its own.** The defaults just move. [U]
- **A checker that grades against references the worker chose itself** (what happened with
  Forma). [O, from our own runs]
- **Uncritiqued self-revision.** [M]

## How Rocket's worker differs from expert practice

| Expert designer | Rocket worker today |
|---|---|
| Frames the user, the one job and the real data first | Starts from the noun "dashboard" |
| Commits to an art direction from visual references | Writes a sentence-long "concept" and builds |
| Diverges (10+ options), then converges | One pass |
| Critiques with reasons across dimensions, keeps the best | Self-checks for function; the checker runs once at the end |
| Polish and edge states are most of the work | Stops when the happy path renders |

## Implications for goals (future work)

Rocket already ships direction in the goal brief (design concept, reference screenshots), the
editable design library, and the goal-preparation skill. The numbered items below are further
experiments not yet in the product.

1. **Direction step (Google method).** Before building, the worker proposes 3 theme specs (type
   pairing, palette with hex values, layout idea, density, signature element), each with a
   typicality score and a note on what makes it typical, then picks a less typical one. The user
   sees the 3 options in the brief and can choose.
2. **Variants plus pairwise selection.** The worker builds the main screen in 2–3 of those
   directions as quick static renders. A vision critic compares them in pairs; the winner is built
   out.
3. **A critique loop during work, not just at the end.** After each build pass: screenshots →
   critique from another model on a multi-dimension rubric (task fit, hierarchy, typography,
   color, density, states, slop tells) → revise. Keep only revisions that score better. 2–3
   cycles, then the existing end-of-round check.
4. **A maintained anti-tells list,** including second-wave tells, plus a deterministic detector
   (Impeccable's `detect`, or our own) that runs before the model critic at no inference cost.
5. **Problem framing and real content** in the brief: user, focal job, data shape and volume, edge
   cases. The worker seeds realistic data before designing.
6. **References as rules.** Each selected reference is turned into a DESIGN.md (named hex values,
   type scale, spacing, component rules), so the worker builds against tokens, not adjectives.
