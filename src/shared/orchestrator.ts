import type { ProviderId } from './types.ts'

export type OrchestratorStatus = 'running' | 'draining' | 'paused' | 'stopped'
export type OrchestratorTask = {
  id: string
  chatId: string
  turnId: string | null
  provider: ProviderId
  task: string
  report: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  result: string
  review: string | null
}

export type Orchestration = {
  id: string
  chatId: string
  cwd: string
  provider: ProviderId
  task: string
  progressFile: string
  status: OrchestratorStatus
  reason: string | null
  summary: string
  next: string
  notes: string
  updates: string[]
  history: Array<{ at: number; summary: string; next: string }>
  tasks: OrchestratorTask[]
  checkpointCycle: number
  cycle: number
  leaderTurnId: string | null
  createdAt: number
  updatedAt: number
}
