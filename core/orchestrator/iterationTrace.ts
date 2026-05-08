// iterationTrace — bridges the orchestrator's in-flight state to the
// persisted IterationRecord. Per docs/specs/orchestrator.md §12.
//
// Lifecycle:
//   * startIterationTrace creates the iterations row (status:running)
//   * record* methods accumulate events in-memory
//   * finishIterationTrace writes back the final record + cost rows

import type Database from 'better-sqlite3'
import {
  startIteration as startIterationDb,
  finishIteration as finishIterationDb,
  type FinishIterationInput,
} from '../../data/iterations.js'
import { appendCostRecord } from '../../data/costRecords.js'
import type { CostTracker } from './CostTracker.js'
import type { RoleConflict } from '@core/types/iteration.js'
import type { RoleType, RoleOutputEnvelope } from '@core/types/role.js'

export type StartTraceArgs = {
  db: Database.Database
  workspace_id: string
  user_prompt: string
}

export function startIterationTrace(args: StartTraceArgs): {
  iteration_id: string
  iteration_number: number
} {
  const record = startIterationDb(args.db, {
    workspace_id: args.workspace_id,
    user_prompt: args.user_prompt,
  })
  return {
    iteration_id: record.id,
    iteration_number: record.iteration_number,
  }
}

export type FinishTraceArgs = {
  db: Database.Database
  iteration_id: string
  workspace_id: string
  status: FinishIterationInput['status']
  traffic_light: FinishIterationInput['traffic_light']
  total_cost_usd: number
  files_changed: string[]
  role_outputs: Partial<Record<RoleType, RoleOutputEnvelope>>
  conflicts: RoleConflict[]
  cost_tracker: CostTracker
}

export function finishIterationTrace(args: FinishTraceArgs): void {
  // Persist cost rows first (depend on iteration_id existing).
  for (const entry of args.cost_tracker.snapshot()) {
    appendCostRecord(args.db, {
      workspace_id: args.workspace_id,
      iteration_id: args.iteration_id,
      role: entry.role,
      provider: entry.provider,
      model: entry.model,
      usage: entry.usage,
      duration_ms: entry.duration_ms,
    })
  }

  finishIterationDb(args.db, {
    iteration_id: args.iteration_id,
    status: args.status,
    traffic_light: args.traffic_light,
    total_cost_usd: args.total_cost_usd,
    files_changed: args.files_changed,
    role_outputs: args.role_outputs,
    conflicts: args.conflicts,
  })
}
