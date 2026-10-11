import type { TurnTokens } from './types.ts'

/** Short label for the turn head: "42% context" or "30k context" when no window size is known. */
export function contextMeterLabel(tokens: TurnTokens | null | undefined): string | null {
  if (!tokens || tokens.context === null) return null
  if (tokens.contextWindow && tokens.contextWindow > 0) {
    const pct = Math.min(100, Math.max(0, Math.round(100 * tokens.context / tokens.contextWindow)))
    return `${pct}% context`
  }
  return `${kilo(tokens.context)} context`
}

function kilo(count: number): string {
  return count < 1_000 ? String(Math.round(count)) : `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`
}
