// The app is finite. This map names every place the shell can show and every action a model can
// take there, so a model navigates by name instead of searching a screenshot for a button. The
// renderer's dispatcher (`src/renderer/src/app-map.ts`) implements every entry and the app's own
// buttons go through the same dispatcher, so what a model does and what a click does is one path.
// The host prints this map into every turn and into the rocket_ui_go / rocket_ui_act schemas.
// Typing the dispatcher's tables with these names makes the typecheck fail on a missing entry.

/** A parameter's name and what it takes. */
export type ParamSpec = Record<string, string>

export type PlaceSpec = {
  description: string
  /** The component that renders it, for a model that has to change how it looks. */
  file: string
  params?: ParamSpec
}

export type ActionSpec = {
  description: string
  params?: ParamSpec
  /** The place the action belongs to; the dispatcher goes there first when it is not shown. */
  place?: PlaceName
}

export const PLACES = {
  chat: { description: 'The chat panes alone, with no side panel.', file: 'src/renderer/src/App.tsx' },
  browser: { description: 'The built-in browser beside the chat.', file: 'src/renderer/src/components/BrowserPanel.tsx' },
  'evals.overview': { description: 'Evals: overview (placeholder).', file: 'src/renderer/src/components/EvalDashboard.tsx' },
  'evals.logs': { description: 'Evals: logs (placeholder).', file: 'src/renderer/src/components/EvalDashboard.tsx' },
  'evals.playgrounds': {
    description: 'Evals: the playground grid, one scenario run across its provider matrix.',
    file: 'src/renderer/src/components/EvalPlayground.tsx',
    params: { scenario: 'scenario id to show', dataset: 'dataset id for the rows', compare: '"base" or a comparison task id', diff: 'true or false' }
  },
  'evals.experiments': { description: 'Evals: the experiments list.', file: 'src/renderer/src/components/EvalDashboard.tsx' },
  'evals.experiment': { description: 'Evals: one experiment and its cells.', file: 'src/renderer/src/components/EvalDashboard.tsx', params: { id: 'experiment id (required)' } },
  'evals.datasets': { description: 'Evals: the datasets list.', file: 'src/renderer/src/components/EvalDashboard.tsx' },
  'evals.dataset': { description: 'Evals: one dataset and its rows.', file: 'src/renderer/src/components/EvalDashboard.tsx', params: { id: 'dataset id (required)' } },
  'evals.scorers': { description: 'Evals: scorers (placeholder).', file: 'src/renderer/src/components/EvalDashboard.tsx' },
  'evals.tools': {
    description: 'Evals: the MCP tool ledger (health) and tool scores (evaluate).',
    file: 'src/renderer/src/components/EvalToolsPanel.tsx',
    params: { section: '"health" or "evaluate"' }
  }
} satisfies Record<string, PlaceSpec>

export type PlaceName = keyof typeof PLACES

export const ACTIONS = {
  'pane.focus': { description: 'Give a chat pane the focus.', params: { pane: 'pane index, from 0' } },
  'pane.add': { description: 'Add a chat pane beside the focused one, showing the new-chat screen.' },
  'pane.close': { description: 'Close a chat pane; the only pane cannot close.', params: { pane: 'pane index' } },
  'chat.open': { description: 'Show a chat in a pane.', params: { chatId: 'chat id (required)', pane: 'pane index, default the focused one' } },
  'chat.new': { description: 'Show the new-chat screen in a pane.', params: { pane: 'pane index, default the focused one' } },
  'evals.sync': { description: 'Reload the eval dashboard from disk and the ledger.', place: 'evals.experiments' },
  'evals.playgrounds.run': {
    description: 'Run playground cells with real provider turns: every visible row and task, one row, or one cell. Returns when the run ends or after `wait` seconds with it still running; rocket_ui_where then shows cell progress.',
    params: { row: 'row number as shown, from 1; omit for all rows', provider: 'provider id for one task; omit for all tasks', wait: 'seconds to wait, default 100, at most 120' },
    place: 'evals.playgrounds'
  },
  'evals.runSheet.open': {
    description: 'Open the Run cell sheet over the experiments list, seeded with a scenario, provider and trial.',
    params: { scenario: 'scenario id', provider: 'provider id', trial: 'trial number, from 0' },
    place: 'evals.experiments'
  },
  'evals.runSheet.run': {
    description: 'Run one matrix cell (a scenario on one provider) with a real provider turn and grade it. Opens the sheet when closed. Returns the grades, or after `wait` seconds with the cell still running.',
    params: { scenario: 'scenario id', provider: 'provider id', trial: 'trial number, from 0', wait: 'seconds to wait, default 100, at most 120' },
    place: 'evals.experiments'
  },
  'evals.runSheet.close': { description: 'Close the Run cell sheet.', place: 'evals.experiments' },
  'evals.tools.refresh': { description: 'Refresh the tool ledger and scores.', place: 'evals.tools' }
} satisfies Record<string, ActionSpec>

export type ActionName = keyof typeof ACTIONS

function paramsText(params: ParamSpec | undefined): string {
  if (!params) return ''
  return ` {${Object.entries(params).map(([name, what]) => `${name}: ${what}`).join('; ')}}`
}

/** The map as a model reads it: one line per place and per action. */
export function describeMap(): string {
  const places = Object.entries(PLACES as Record<string, PlaceSpec>).map(([name, spec]) => `- ${name}${paramsText(spec.params)} — ${spec.description} [${spec.file}]`)
  const actions = Object.entries(ACTIONS as Record<string, ActionSpec>).map(([name, spec]) => `- ${name}${paramsText(spec.params)} — ${spec.description}`)
  return `Places (rocket_ui_go):\n${places.join('\n')}\nActions (rocket_ui_act):\n${actions.join('\n')}`
}

export function isPlace(name: unknown): name is PlaceName {
  return typeof name === 'string' && Object.hasOwn(PLACES, name)
}

export function isAction(name: unknown): name is ActionName {
  return typeof name === 'string' && Object.hasOwn(ACTIONS, name)
}
