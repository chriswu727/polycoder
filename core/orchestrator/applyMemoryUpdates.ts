// applyMemoryUpdates — translate Architect's memory_updates payload
// into a data-layer call. Called AFTER a successful pipeline (per
// docs/specs/orchestrator.md §11) so partial memory mutations from
// failed iterations don't pollute the workspace.

import type Database from 'better-sqlite3'
import { applyMemoryUpdate } from '../../data/projectMemory.js'
import type { ArchitectPayload } from '@core/types/payloads/architect.js'
import type { MemoryUpdateInput } from '@core/types/projectMemory.js'

export type ApplyMemoryUpdatesArgs = {
  db: Database.Database
  workspace_id: string
  iteration_number: number
  architect_payload: ArchitectPayload | undefined
}

export type MemoryDelta = {
  decisions_added: number
  conventions_added: number
  components_added: number
  tech_debt_added: number
  superseded: number
  design_tokens_set: boolean
}

const ZERO_DELTA: MemoryDelta = {
  decisions_added: 0,
  conventions_added: 0,
  components_added: 0,
  tech_debt_added: 0,
  superseded: 0,
  design_tokens_set: false,
}

/**
 * Translate the Architect's memory_updates field into structured
 * updates and apply them transactionally. No-ops (zero delta) when
 * Architect produced no payload, no memory_updates, or status was
 * conflict_detected.
 */
export function applyMemoryUpdates(args: ApplyMemoryUpdatesArgs): MemoryDelta {
  const { db, workspace_id, iteration_number, architect_payload } = args
  if (!architect_payload || !architect_payload.memory_updates) {
    return ZERO_DELTA
  }

  const updates = architect_payload.memory_updates

  // Translate to MemoryUpdateInput shape (data layer).
  const input: MemoryUpdateInput = {
    add_decisions: updates.new_decisions?.map((d) => ({
      decision: d.decision,
      rationale: d.rationale,
      added_in_iteration: iteration_number,
    })),
    add_conventions: updates.new_conventions?.map((c) => ({
      convention: c.convention,
      scope: c.scope,
      added_in_iteration: iteration_number,
    })),
    add_components: updates.components_registered?.map((c) => ({
      name: c.name,
      path: c.path,
      purpose: c.purpose,
      added_in_iteration: iteration_number,
    })),
    add_tech_debt: architect_payload.tech_debt_added?.map((t) => ({
      file: t.file,
      issue: t.issue,
      severity: t.severity,
      introduced_by_role: t.introduced_by_role ?? null,
      added_in_iteration: iteration_number,
    })),
  }

  return applyMemoryUpdate(
    db,
    { workspace_id, iteration_number },
    input,
  )
}
