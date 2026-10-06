import type { GoalRunner } from '../goals.ts'
import { textResult, type Tool } from './registry.ts'

// The one tool goals add. The worker hands over the brief and says when it is done or needs the
// user; the checker hands over its verdict. Both must be structured, which is why this is a tool
// and not a reply. It is one tool, not three, because every schema costs every session prompt
// space; the runner knows the calling turn's role and checks the arguments against it.

const DESCRIPTION = `Only for Rocket goals: report to the app when the message you were given asks you to. Drafting a goal's brief: give goal, criteria, design for visual work and, if needed, question. Working on a goal: give status ("done" or "needs_you") and summary. Checking a goal: give verdicts (one per line of the checklist) and findings.`

export function goalTools(goals: () => GoalRunner): Tool[] {
  return [
    {
      name: 'goal_report',
      description: DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'Drafting: what will be true when it is finished, in one or two plain sentences.' },
          criteria: {
            type: 'array',
            description: 'Drafting: the lines that define done.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'One checkable fact about the finished result, in plain words.' },
                how: { type: 'string', description: 'How it will be checked, in a few words.' }
              },
              required: ['text', 'how']
            }
          },
          design: {
            type: 'object',
            description: 'Drafting, for visual work only: the design concept and the references you opened.',
            properties: {
              concept: { type: 'string', description: 'The one idea that makes this design specific to its product, in a sentence or two.' },
              references: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    source: { type: 'string', description: 'The URL or library entry.' },
                    screenshot: { type: 'string', description: 'Path of the screenshot you saved of it.' },
                    takes: { type: 'string', description: 'What this design borrows from it.' }
                  },
                  required: ['source', 'screenshot', 'takes']
                }
              }
            }
          },
          question: {
            type: 'object',
            description: 'Drafting: one question for the user, only if the answer would change the work.',
            properties: { text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }
          },
          status: { type: 'string', enum: ['done', 'needs_you'], description: 'Working: done, or needs_you for a decision only the user can make.' },
          summary: { type: 'string', description: 'Working: what you did, or your question for the user.' },
          verdicts: {
            type: 'array',
            description: 'Checking: one per line of the checklist.',
            items: {
              type: 'object',
              properties: {
                line: { type: 'integer', description: 'The line number, from 1.' },
                met: { type: 'boolean' },
                evidence: { type: 'string', description: 'What you saw, in a sentence.' }
              },
              required: ['line', 'met', 'evidence']
            }
          },
          findings: { type: 'string', description: 'Checking: what is still wrong, specific enough to fix; empty when every line is met.' }
        },
        additionalProperties: false
      },
      run: (args, context) => {
        const result = goals().report(context.chatId, args)
        return result.ok ? textResult(result.text) : { ...textResult(result.text), isError: true }
      }
    }
  ]
}
