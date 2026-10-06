import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostEvent, UsageSnapshot } from '../shared/types.ts'
import { EvalExport } from './eval-export.ts'
import { GoalRunner } from './goals.ts'
import { Hub, type TurnTiming } from './hub.ts'
import { AntigravityAdapter } from './providers/antigravity.ts'
import { ClaudeAdapter } from './providers/claude.ts'
import { CodexAdapter } from './providers/codex.ts'
import { CursorAdapter } from './providers/cursor.ts'
import { Store } from './store.ts'
import { askTools } from './tools/ask.ts'
import { browserTools } from './tools/browser.ts'
import { ToolChannel } from './tools/channel.ts'
import { goalTools } from './tools/goal.ts'
import { ToolRegistry } from './tools/registry.ts'
import { evalFixtureAdapters } from './eval-fixture-adapters.ts'
import { uiTestProfile, UiTestAdapter } from './ui-test.ts'
import { rocketSourceRoot } from './tools/ui-run.ts'

export type EvalRuntime = {
  store: Store
  hub: Hub
  goals: GoalRunner
  evalExport: EvalExport
  tools: ToolChannel
  timingForChat: (chatId: string) => TurnTiming | undefined
  shutdown: () => Promise<void>
}

/** Hub + goals + eval export for matrix runs under plain Node (same send path as the app). */
export async function createEvalRuntime(options: { dataDir?: string; repoRoot?: string } = {}): Promise<EvalRuntime> {
  const repoRoot = options.repoRoot ?? rocketSourceRoot()
  const dataDir = options.dataDir ?? join(homedir(), '.config', 'rocket')
  const store = new Store(join(dataDir, 'rocket-eval-matrix.db'))
  const turnTiming = new Map<string, TurnTiming>()
  const fixture = process.env.ROCKET_EVAL_FIXTURE === '1'
  const testProfile = fixture ? null : uiTestProfile()

  const emit = (_event: HostEvent): void => {}
  let hub!: Hub
  let goals!: GoalRunner
  const tools = new ToolChannel(
    new ToolRegistry()
      .add(...browserTools({
        request: async () => { throw new Error('The browser is only available inside the app') }
      }, join(dataDir, 'browser-results')))
      .add(...askTools(() => hub))
      .add(...goalTools(() => goals)),
    null,
    (provider) => hub.runningChat(provider)
  )
  await tools.start()

  const onUsage = (snapshot: UsageSnapshot): void => { hub.noteUsage(snapshot) }
  const adapters = fixture
    ? evalFixtureAdapters()
    : testProfile
    ? {
      codex: new UiTestAdapter('codex', testProfile),
      claude: new UiTestAdapter('claude', testProfile),
      cursor: new UiTestAdapter('cursor', testProfile),
      antigravity: new UiTestAdapter('antigravity', testProfile)
    }
    : {
      codex: new CodexAdapter(onUsage, tools),
      claude: new ClaudeAdapter(onUsage, tools),
      cursor: new CursorAdapter(tools),
      antigravity: new AntigravityAdapter(tools, 'rocket_eval_matrix')
    }

  hub = new Hub(store, adapters, emit, (timing) => { turnTiming.set(timing.chatId, timing) })
  goals = new GoalRunner(store, hub, () => {})
  const evalExport = new EvalExport(dataDir, repoRoot, () => store, () => undefined)

  return {
    store,
    hub,
    goals,
    evalExport,
    tools,
    timingForChat: (chatId) => turnTiming.get(chatId),
    shutdown: async () => {
      await hub.shutdown()
      if (!testProfile && adapters.antigravity instanceof AntigravityAdapter) await adapters.antigravity.unregisterTools()
      tools.stop()
      store.close()
    }
  }
}
