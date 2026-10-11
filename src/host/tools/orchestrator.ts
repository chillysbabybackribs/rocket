import { PROVIDERS, type ProviderId } from '../../shared/types.ts'
import type { Orchestrator } from '../orchestrator.ts'
import { messageOf, stringOf } from '../json.ts'
import { failureResult, textResult, type Tool } from './registry.ts'

export function orchestratorTools(runner: () => Orchestrator): Tool[] {
  return [{
    name: 'orchestrator',
    description: 'Run a continuous user-requested task from this owning chat. Start only when the user asks for continuous orchestration. Dispatch fresh worker chats, review their actual reports, and checkpoint progress/next questions in a readable Markdown file. The host continues review turns when this turn ends; there is no fixed round limit. All turns use provider default models. User notes in the progress file and chat messages steer future work. Stop prevents new dispatch; drain finishes current workers. Workers cannot control other runs. Return progress updates to the user and do not confuse completed turns or report existence with verified work.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'status', 'dispatch', 'checkpoint', 'wait', 'resume', 'stop'] },
        task: { type: 'string', description: 'Start: the user task. Dispatch: one focused follow-up assignment.' },
        provider: { type: 'string', enum: PROVIDERS.map(provider => provider.id), description: 'Dispatch: worker provider; its configured default model is used.' },
        summary: { type: 'string', description: 'Checkpoint: clear progress and accepted findings, with limitations.' },
        next: { type: 'string', description: 'Checkpoint: the next question/action based on gathered evidence.' },
        taskId: { type: 'string', description: 'Checkpoint: finished worker task being reviewed.' },
        review: { type: 'string', description: 'Checkpoint: evidence accepted, rejected and still uncertain for taskId.' },
        seconds: { type: 'number', description: 'Wait up to 25 seconds for a progress change; default 20.' },
        drain: { type: 'boolean', description: 'Stop: true lets workers finish and writes a final review; false requests cancellation. Default true.' }
      },
      required: ['action'], additionalProperties: false
    },
    run: async (args, context) => {
      try {
        if (!context.chatId) throw new Error('The calling chat could not be identified. Use a provider with a chat-bound tool connection.')
        const host = runner()
        if (host.stateError) throw new Error(host.stateError)
        const chat = context.chatId
        let result
        switch (args.action) {
          case 'start': result = host.start(chat, context.provider, stringOf(args.task)); break
          case 'status': result = host.get(chat); break
          case 'dispatch': {
            const provider = PROVIDERS.find(entry => entry.id === args.provider)?.id
            if (!provider) throw new Error('Choose a worker provider.')
            result = host.dispatch(chat, provider as ProviderId, stringOf(args.task)); break
          }
          case 'checkpoint': result = host.checkpoint(chat, stringOf(args.summary), stringOf(args.next), stringOf(args.taskId) || undefined, stringOf(args.review)); break
          case 'wait': result = await host.wait(chat, typeof args.seconds === 'number' && Number.isFinite(args.seconds) ? args.seconds : 20); break
          case 'resume': result = host.resume(chat); break
          case 'stop': result = host.stop(chat, args.drain !== false); break
          default: throw new Error('Choose start, status, dispatch, checkpoint, wait, resume, or stop.')
        }
        if (!result) return textResult('This chat does not own an orchestration.')
        const pending = result.tasks.filter(task => !task.review || task.status === 'running')
        return textResult(JSON.stringify({ ...result, history: result.history.slice(-3), updates: result.updates.slice(-10), tasks: pending.slice(-12), totalTasks: result.tasks.length, omittedPendingTasks: Math.max(0, pending.length - 12), instruction: 'Full progress, history and reports are in progressFile. Review evidence before checkpointing.' }))
      } catch (error) { return failureResult('ORCHESTRATOR', messageOf(error), 'operation') }
    }
  }]
}
