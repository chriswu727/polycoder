// Iteration history CRUD. Each iteration is one full pipeline run
// (Translator → ... → Communicator). See docs/specs/orchestrator.md §13.

import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  IterationRecordSchema,
  type IterationRecord,
  type IterationStatus,
  type IterationTrafficLight,
  type RoleConflict,
} from '@core/types/iteration.js'
import type { RoleType, RoleOutputEnvelope } from '@core/types/role.js'

// ─── Create ─────────────────────────────────────────────────────────

export type StartIterationInput = {
  workspace_id: string
  user_prompt: string
}

export function startIteration(
  db: Database.Database,
  input: StartIterationInput,
): IterationRecord {
  // Determine next iteration_number.
  const last = db
    .prepare(
      'SELECT COALESCE(MAX(iteration_number), 0) as n FROM iterations WHERE workspace_id = ?',
    )
    .get(input.workspace_id) as { n: number }

  const record: IterationRecord = IterationRecordSchema.parse({
    id: randomUUID(),
    workspace_id: input.workspace_id,
    iteration_number: last.n + 1,
    user_prompt: input.user_prompt,
    status: 'running' satisfies IterationStatus,
    traffic_light: null,
    started_at: Date.now(),
    ended_at: null,
    duration_ms: null,
    total_cost_usd: null,
    files_changed: [],
    role_outputs_json: '{}',
    conflicts_json: '[]',
  })

  db.prepare(
    `INSERT INTO iterations
     (id, workspace_id, iteration_number, user_prompt, status,
      traffic_light, started_at, ended_at, duration_ms, total_cost_usd,
      files_changed, role_outputs_json, conflicts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.workspace_id,
    record.iteration_number,
    record.user_prompt,
    record.status,
    record.traffic_light,
    record.started_at,
    record.ended_at,
    record.duration_ms,
    record.total_cost_usd,
    JSON.stringify(record.files_changed),
    record.role_outputs_json,
    record.conflicts_json,
  )

  return record
}

// ─── Update on completion / abort / failure ─────────────────────────

export type FinishIterationInput = {
  iteration_id: string
  status: Exclude<IterationStatus, 'running' | 'awaiting_user'>
  traffic_light: IterationTrafficLight | null
  total_cost_usd: number
  files_changed: string[]
  role_outputs: Partial<Record<RoleType, RoleOutputEnvelope>>
  conflicts: RoleConflict[]
}

export function finishIteration(
  db: Database.Database,
  input: FinishIterationInput,
): IterationRecord {
  const now = Date.now()
  const startedAt = (
    db
      .prepare('SELECT started_at FROM iterations WHERE id = ?')
      .get(input.iteration_id) as { started_at: number } | undefined
  )?.started_at
  if (startedAt === undefined) {
    throw new Error(`Iteration not found: ${input.iteration_id}`)
  }
  const duration_ms = now - startedAt

  db.prepare(
    `UPDATE iterations
     SET status = ?,
         traffic_light = ?,
         ended_at = ?,
         duration_ms = ?,
         total_cost_usd = ?,
         files_changed = ?,
         role_outputs_json = ?,
         conflicts_json = ?
     WHERE id = ?`,
  ).run(
    input.status,
    input.traffic_light,
    now,
    duration_ms,
    input.total_cost_usd,
    JSON.stringify(input.files_changed),
    JSON.stringify(input.role_outputs),
    JSON.stringify(input.conflicts),
    input.iteration_id,
  )

  const updated = getIteration(db, input.iteration_id)
  if (!updated) throw new Error(`Iteration disappeared: ${input.iteration_id}`)
  return updated
}

// ─── Read ───────────────────────────────────────────────────────────

export function getIteration(
  db: Database.Database,
  id: string,
): IterationRecord | null {
  const row = db
    .prepare('SELECT * FROM iterations WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return parseRow(row)
}

export type IterationSummary = {
  id: string
  iteration_number: number
  user_prompt: string
  status: IterationStatus
  traffic_light: IterationTrafficLight | null
  started_at: number
  duration_ms: number | null
  total_cost_usd: number | null
  /**
   * Derived from role_outputs_json shape: a row with only `coder` in
   * role_outputs is a Quick Edit run. The renderer uses this to
   * tag the sidebar row distinctly without needing to fetch the full
   * iteration record.
   */
  mode: 'full' | 'quick'
}

export function listIterations(
  db: Database.Database,
  workspaceId: string,
  opts: { limit?: number; offset?: number } = {},
): IterationSummary[] {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const rows = db
    .prepare(
      `SELECT id, iteration_number, user_prompt, status, traffic_light,
              started_at, duration_ms, total_cost_usd, role_outputs_json
       FROM iterations
       WHERE workspace_id = ?
       ORDER BY iteration_number DESC
       LIMIT ? OFFSET ?`,
    )
    .all(workspaceId, limit, offset) as Array<Record<string, unknown>>
  return rows.map((r) => {
    let mode: 'full' | 'quick' = 'full'
    try {
      const outputs = JSON.parse(r.role_outputs_json as string) as Record<
        string,
        unknown
      >
      const keys = Object.keys(outputs)
      if (keys.length === 1 && keys[0] === 'coder') mode = 'quick'
    } catch {
      // Bad JSON in DB — treat as full and move on. Old rows
      // pre-quick-edit obviously fall into this branch too.
    }
    return {
      id: r.id as string,
      iteration_number: r.iteration_number as number,
      user_prompt: r.user_prompt as string,
      status: r.status as IterationStatus,
      traffic_light: (r.traffic_light as IterationTrafficLight | null) ?? null,
      started_at: r.started_at as number,
      duration_ms: (r.duration_ms as number | null) ?? null,
      total_cost_usd: (r.total_cost_usd as number | null) ?? null,
      mode,
    }
  })
}

function parseRow(row: Record<string, unknown>): IterationRecord {
  return IterationRecordSchema.parse({
    ...row,
    files_changed: JSON.parse(row.files_changed as string) as string[],
  })
}

// ─── Delete (used by workspace cascade; also direct for tests) ──────

export function deleteIteration(db: Database.Database, id: string): void {
  // cost_records has ON DELETE CASCADE; deleting the iteration cleans those.
  db.prepare('DELETE FROM iterations WHERE id = ?').run(id)
}
