// Project memory CRUD. The Architect role's persistent state.
// Stored as a single JSON blob per workspace (read pattern is always
// full snapshot). Updates are structured per docs/specs/tools.md §4.6.

import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  ProjectMemorySchema,
  emptyProjectMemory,
  type ProjectMemory,
  type MemoryUpdateInput,
  type Convention,
  type Decision,
  type ComponentRegistryEntry,
  type TechDebt,
} from '@core/types/projectMemory.js'

// ─── Read ───────────────────────────────────────────────────────────

export function getProjectMemory(
  db: Database.Database,
  workspaceId: string,
): ProjectMemory | null {
  const row = db
    .prepare(
      'SELECT memory_json FROM project_memory WHERE workspace_id = ?',
    )
    .get(workspaceId) as { memory_json: string } | undefined
  if (!row) return null
  return ProjectMemorySchema.parse(JSON.parse(row.memory_json))
}

// ─── Write (full replace) ───────────────────────────────────────────

export function saveProjectMemory(
  db: Database.Database,
  memory: ProjectMemory,
): void {
  // Validate before persist; cheap insurance against accidental shape drift.
  const validated = ProjectMemorySchema.parse(memory)
  const updated = { ...validated, updated_at: Date.now() }
  db.prepare(
    `INSERT INTO project_memory (workspace_id, memory_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE
     SET memory_json = excluded.memory_json,
         updated_at = excluded.updated_at`,
  ).run(updated.workspace_id, JSON.stringify(updated), updated.updated_at)
}

// ─── Apply structured update ────────────────────────────────────────

export type ApplyUpdateContext = {
  workspace_id: string
  iteration_number: number
}

/**
 * Apply a memory update emitted by the Architect role. Mutates the
 * persisted memory in a single transaction. Returns the deltas applied
 * (counts) for telemetry.
 */
export function applyMemoryUpdate(
  db: Database.Database,
  ctx: ApplyUpdateContext,
  update: MemoryUpdateInput,
): {
  decisions_added: number
  conventions_added: number
  components_added: number
  tech_debt_added: number
  superseded: number
  design_tokens_set: boolean
} {
  const tx = db.transaction(() => {
    const memory =
      getProjectMemory(db, ctx.workspace_id) ??
      emptyProjectMemory(ctx.workspace_id)
    const now = Date.now()

    let decisions_added = 0
    let conventions_added = 0
    let components_added = 0
    let tech_debt_added = 0
    let superseded = 0
    let design_tokens_set = false

    if (update.add_decisions) {
      for (const d of update.add_decisions) {
        const full: Decision = {
          id: randomUUID(),
          decision: d.decision,
          rationale: d.rationale,
          supersedes: null,
          superseded_by: null,
          added_in_iteration: d.added_in_iteration ?? ctx.iteration_number,
          added_at: now,
        }
        memory.decisions.push(full)
        decisions_added++
      }
    }

    if (update.add_conventions) {
      for (const c of update.add_conventions) {
        const full: Convention = {
          id: randomUUID(),
          convention: c.convention,
          scope: c.scope,
          added_in_iteration: c.added_in_iteration ?? ctx.iteration_number,
          added_at: now,
        }
        memory.conventions.push(full)
        conventions_added++
      }
    }

    if (update.add_components) {
      for (const c of update.add_components) {
        const full: ComponentRegistryEntry = {
          id: randomUUID(),
          name: c.name,
          path: c.path,
          purpose: c.purpose,
          added_in_iteration: c.added_in_iteration ?? ctx.iteration_number,
          added_at: now,
        }
        memory.components_registry.push(full)
        components_added++
      }
    }

    if (update.add_tech_debt) {
      for (const t of update.add_tech_debt) {
        const full: TechDebt = {
          id: randomUUID(),
          file: t.file,
          issue: t.issue,
          severity: t.severity,
          introduced_by_role: t.introduced_by_role,
          added_in_iteration: t.added_in_iteration ?? ctx.iteration_number,
          added_at: now,
          resolved: false,
          resolved_in_iteration: null,
        }
        memory.tech_debt.push(full)
        tech_debt_added++
      }
    }

    if (update.supersede_decisions) {
      for (const s of update.supersede_decisions) {
        const old = memory.decisions.find((d) => d.id === s.old_decision_id)
        if (!old) {
          throw new Error(
            `supersede_decisions: old_decision_id not found: ${s.old_decision_id}`,
          )
        }
        const newDecision: Decision = {
          id: randomUUID(),
          decision: s.new_decision.decision,
          rationale: s.new_decision.rationale,
          supersedes: old.id,
          superseded_by: null,
          added_in_iteration:
            s.new_decision.added_in_iteration ?? ctx.iteration_number,
          added_at: now,
        }
        old.superseded_by = newDecision.id
        memory.decisions.push(newDecision)
        superseded++
      }
    }

    if (update.set_design_tokens) {
      memory.design_tokens = update.set_design_tokens
      design_tokens_set = true
    }

    memory.updated_at = now
    saveProjectMemory(db, memory)

    return {
      decisions_added,
      conventions_added,
      components_added,
      tech_debt_added,
      superseded,
      design_tokens_set,
    }
  })

  return tx()
}

// ─── Tech debt resolution ───────────────────────────────────────────

export function markTechDebtResolved(
  db: Database.Database,
  workspaceId: string,
  techDebtId: string,
  resolvedInIteration: number,
): void {
  const memory = getProjectMemory(db, workspaceId)
  if (!memory) throw new Error(`Workspace not found: ${workspaceId}`)
  const entry = memory.tech_debt.find((t) => t.id === techDebtId)
  if (!entry) throw new Error(`Tech debt not found: ${techDebtId}`)
  entry.resolved = true
  entry.resolved_in_iteration = resolvedInIteration
  saveProjectMemory(db, memory)
}
