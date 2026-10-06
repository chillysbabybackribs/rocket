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
  'evals.scenarios': {
    description: 'Evals: the scenario list, each with its latest run per provider.',
    file: 'src/renderer/src/components/EvalPanel.tsx'
  },
  'evals.scenario': {
    description: 'Evals: one scenario: its message (editable before a run), graders, the provider × trial grid of the run shown, and earlier runs.',
    file: 'src/renderer/src/components/EvalScenario.tsx',
    params: { id: 'scenario id (required)', run: 'run id to show, default the latest' }
  },
  'evals.run': {
    description: 'Evals: one cell of a run: its grades, the files it changed, and its transcript.',
    file: 'src/renderer/src/components/EvalRunView.tsx',
    params: { run: 'run id (required)', provider: 'provider id (required)', trial: 'trial number from 0, default 0' }
  },
  'evals.tools': {
    description: 'Evals: the MCP tool ledger (health) and tool scores (evaluate).',
    file: 'src/renderer/src/components/EvalToolsPanel.tsx',
    params: { section: '"health" or "evaluate"' }
  },
  library: {
    description: 'The library beside the chat: every file the chats attached, downloaded, wrote as plans or opened, as a grid or list. Filters given here replace the shown ones; library_list lists the same files.',
    file: 'src/renderer/src/components/LibraryPanel.tsx',
    params: {
      source: 'attachment, download, plan or opened',
      kind: 'pdf, markdown, text, image, office or other',
      chat: 'chat id',
      added: 'today, yesterday, week or older',
      q: 'words to search for',
      view: '"grid" or "list"'
    }
  }
} satisfies Record<string, PlaceSpec>

export type PlaceName = keyof typeof PLACES

export const ACTIONS = {
  'pane.focus': { description: 'Give a chat pane the focus.', params: { pane: 'pane index, from 0' } },
  'pane.add': { description: 'Add a chat pane showing the new-chat screen, and give it the focus.', params: { after: 'pane index to add after, default the focused one' } },
  'pane.close': { description: 'Close a chat pane; the only pane cannot close.', params: { pane: 'pane index' } },
  'chat.open': { description: 'Show a chat in a pane.', params: { chatId: 'chat id (required)', pane: 'pane index, default the focused one' } },
  'chat.new': { description: 'Show the new-chat screen in a pane.', params: { pane: 'pane index, default the focused one' } },
  'evals.sync': { description: 'Reload the scenario files and saved runs from disk; opens the eval panel when it is closed.' },
  'evals.run.start': {
    description: 'Run the scenario shown on every provider in its matrix with real provider turns (spends subscription usage): providers side by side, each provider\'s trials in turn, each in a fresh copy of the scenario\'s folder. Returns the graded run when it ends, or after `wait` seconds with it still running; rocket_ui_where then shows its cells.',
    params: { scenario: 'scenario id, default the one shown', message: 'message for this run instead of the scenario\'s', wait: 'seconds to wait, default 100, at most 120' },
    place: 'evals.scenario'
  },
  'evals.run.stop': { description: 'Stop the shown scenario\'s running run: running turns stop and queued cells never start.', place: 'evals.scenario' },
  'evals.tools.refresh': { description: 'Refresh the tool ledger and scores.', place: 'evals.tools' },
  'library.clear': { description: 'Clear the library\'s filters and search.', place: 'library' },
  'library.open': { description: 'Open a library file in the side panel (text, Markdown, PDF pages or a picture); closing it returns to the library.', params: { id: 'file id from library_list (required)' }, place: 'library' }
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
