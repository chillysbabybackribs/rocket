# Braintrust UI regression eval

## One-time setup

1. Log in: `bt login` (or set `BRAINTRUST_API_KEY`).
2. Dataset **rocket-ui-regression** lives in Braintrust project **My Project** (import from `rocket-ui-regression.csv` if needed).

## Remote eval (Experiments UI)

```bash
npm install --include=dev   # braintrust is a devDependency
npm run eval:ui:dev         # http://localhost:8300
```

In Braintrust: **Experiments** → **Task** → **Remote eval** → **http://localhost:8300** → pick the eval → **Create**.

Each dataset row runs `npm run check:ui -- --grep=<playwright_grep>`. Expect several minutes per row (full build + Playwright).

## CLI (no UI)

```bash
npm run eval:ui
```

Uses `evals/rocket-ui-regression.eval.ts` and uploads results to **My Project**.
