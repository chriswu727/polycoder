// Cost records CRUD. One row per role invocation; aggregates computed
// on read. See docs/specs/orchestrator.md §8.

import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  CostRecordSchema,
  type CostRecord,
  type CostAggregate,
  type TokenUsage,
} from '@core/types/cost.js'
import type { ProviderId } from '@core/types/workspace.js'
import type { RoleType } from '@core/types/role.js'

// ─── Append ────────────────────────────────────────────────────────

export type AppendCostRecordInput = {
  workspace_id: string
  iteration_id: string
  role: RoleType
  provider: ProviderId
  model: string
  usage: TokenUsage
  duration_ms: number
}

export function appendCostRecord(
  db: Database.Database,
  input: AppendCostRecordInput,
): CostRecord {
  const record: CostRecord = CostRecordSchema.parse({
    id: randomUUID(),
    workspace_id: input.workspace_id,
    iteration_id: input.iteration_id,
    role: input.role,
    provider: input.provider,
    model: input.model,
    input_tokens: input.usage.input_tokens,
    output_tokens: input.usage.output_tokens,
    cached_input_tokens: input.usage.cached_input_tokens,
    estimated_cost_usd: input.usage.estimated_cost_usd,
    duration_ms: input.duration_ms,
    recorded_at: Date.now(),
  })

  db.prepare(
    `INSERT INTO cost_records
     (id, workspace_id, iteration_id, role, provider, model,
      input_tokens, output_tokens, cached_input_tokens,
      estimated_cost_usd, duration_ms, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.workspace_id,
    record.iteration_id,
    record.role,
    record.provider,
    record.model,
    record.input_tokens,
    record.output_tokens,
    record.cached_input_tokens,
    record.estimated_cost_usd,
    record.duration_ms,
    record.recorded_at,
  )

  return record
}

// ─── Aggregates ─────────────────────────────────────────────────────

export function totalsByIteration(
  db: Database.Database,
  iterationId: string,
): CostAggregate {
  return aggregateWhere(db, 'iteration_id = ?', [iterationId])
}

export function totalsByWorkspace(
  db: Database.Database,
  workspaceId: string,
): CostAggregate {
  return aggregateWhere(db, 'workspace_id = ?', [workspaceId])
}

export function totalsByModel(
  db: Database.Database,
  workspaceId: string,
): Map<string, CostAggregate> {
  const rows = db
    .prepare(
      `SELECT model,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cached_input_tokens) as cached_input_tokens,
              SUM(estimated_cost_usd) as cost,
              COUNT(*) as call_count
       FROM cost_records
       WHERE workspace_id = ?
       GROUP BY model`,
    )
    .all(workspaceId) as Array<{
    model: string
    input_tokens: number
    output_tokens: number
    cached_input_tokens: number
    cost: number
    call_count: number
  }>
  const out = new Map<string, CostAggregate>()
  for (const r of rows) {
    out.set(r.model, {
      total_cost_usd: r.cost ?? 0,
      total_input_tokens: r.input_tokens ?? 0,
      total_output_tokens: r.output_tokens ?? 0,
      total_cached_input_tokens: r.cached_input_tokens ?? 0,
      call_count: r.call_count,
    })
  }
  return out
}

export function totalsByRole(
  db: Database.Database,
  workspaceId: string,
): Map<RoleType, CostAggregate> {
  const rows = db
    .prepare(
      `SELECT role,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cached_input_tokens) as cached_input_tokens,
              SUM(estimated_cost_usd) as cost,
              COUNT(*) as call_count
       FROM cost_records
       WHERE workspace_id = ?
       GROUP BY role`,
    )
    .all(workspaceId) as Array<{
    role: RoleType
    input_tokens: number
    output_tokens: number
    cached_input_tokens: number
    cost: number
    call_count: number
  }>
  const out = new Map<RoleType, CostAggregate>()
  for (const r of rows) {
    out.set(r.role, {
      total_cost_usd: r.cost ?? 0,
      total_input_tokens: r.input_tokens ?? 0,
      total_output_tokens: r.output_tokens ?? 0,
      total_cached_input_tokens: r.cached_input_tokens ?? 0,
      call_count: r.call_count,
    })
  }
  return out
}

function aggregateWhere(
  db: Database.Database,
  whereClause: string,
  params: unknown[],
): CostAggregate {
  const row = db
    .prepare(
      `SELECT SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cached_input_tokens) as cached_input_tokens,
              SUM(estimated_cost_usd) as cost,
              COUNT(*) as call_count
       FROM cost_records WHERE ${whereClause}`,
    )
    .get(...params) as {
    input_tokens: number | null
    output_tokens: number | null
    cached_input_tokens: number | null
    cost: number | null
    call_count: number
  }
  return {
    total_cost_usd: row.cost ?? 0,
    total_input_tokens: row.input_tokens ?? 0,
    total_output_tokens: row.output_tokens ?? 0,
    total_cached_input_tokens: row.cached_input_tokens ?? 0,
    call_count: row.call_count,
  }
}

// ─── Read raw records (for audit/debug UI) ──────────────────────────

export function listCostRecordsForIteration(
  db: Database.Database,
  iterationId: string,
): CostRecord[] {
  const rows = db
    .prepare(
      'SELECT * FROM cost_records WHERE iteration_id = ? ORDER BY recorded_at',
    )
    .all(iterationId) as Record<string, unknown>[]
  return rows.map((r) => CostRecordSchema.parse(r))
}
