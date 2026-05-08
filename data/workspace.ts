// Workspace CRUD. Operates on a Database instance (DI for testability).
// Use openDatabase() from connection.ts to obtain one.

import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  WorkspaceSchema,
  SecretMetaSchema,
  RoleAssignmentSchema,
  type Workspace,
  type SecretMeta,
  type RoleAssignment,
  type HydratedWorkspace,
  type PresetId,
  type ProviderId,
} from '@core/types/index.js'
import { ALL_ROLES, type RoleType } from '@core/types/role.js'

// ─── Workspace CRUD ─────────────────────────────────────────────────

export type CreateWorkspaceInput = {
  name: string
  workspace_root: string
  ui_lang?: 'zh-CN' | 'en'
  preset?: PresetId
}

export function createWorkspace(
  db: Database.Database,
  input: CreateWorkspaceInput,
): Workspace {
  const now = Date.now()
  const ws: Workspace = WorkspaceSchema.parse({
    id: randomUUID(),
    name: input.name,
    workspace_root: input.workspace_root,
    ui_lang: input.ui_lang ?? 'zh-CN',
    preset: input.preset ?? 'custom',
    created_at: now,
    updated_at: now,
  })

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO workspaces
       (id, name, workspace_root, ui_lang, preset, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ws.id,
      ws.name,
      ws.workspace_root,
      ws.ui_lang,
      ws.preset,
      ws.created_at,
      ws.updated_at,
    )

    // Seed empty role assignments for all 8 roles. RoleAssignment rows are
    // always present; null secret_id signals "unconfigured".
    const insertAssignment = db.prepare(
      `INSERT INTO role_assignments
       (workspace_id, role, secret_id, model_id,
        fallback_secret_id, fallback_model_id, custom_prompt_override)
       VALUES (?, ?, NULL, NULL, NULL, NULL, NULL)`,
    )
    for (const role of ALL_ROLES) {
      insertAssignment.run(ws.id, role)
    }

    // Seed empty project memory.
    db.prepare(
      `INSERT INTO project_memory (workspace_id, memory_json, updated_at)
       VALUES (?, ?, ?)`,
    ).run(ws.id, JSON.stringify(emptyMemoryJson(ws.id)), now)
  })
  tx()

  return ws
}

function emptyMemoryJson(workspaceId: string) {
  return {
    workspace_id: workspaceId,
    conventions: [],
    decisions: [],
    components_registry: [],
    tech_debt: [],
    design_tokens: {
      colors: {},
      typography: { font_family: '', scale: [] },
      spacing: { unit: '4px', scale: [] },
      established_in_iteration: null,
    },
    updated_at: Date.now(),
  }
}

export function getWorkspace(
  db: Database.Database,
  id: string,
): Workspace | null {
  const row = db
    .prepare('SELECT * FROM workspaces WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return WorkspaceSchema.parse(row)
}

export function listWorkspaces(db: Database.Database): Workspace[] {
  const rows = db
    .prepare('SELECT * FROM workspaces ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[]
  return rows.map((r) => WorkspaceSchema.parse(r))
}

export type UpdateWorkspaceInput = Partial<{
  name: string
  ui_lang: 'zh-CN' | 'en'
  preset: PresetId
}>

export function updateWorkspace(
  db: Database.Database,
  id: string,
  patch: UpdateWorkspaceInput,
): Workspace {
  const existing = getWorkspace(db, id)
  if (!existing) throw new Error(`Workspace not found: ${id}`)

  const now = Date.now()
  const next: Workspace = {
    ...existing,
    ...patch,
    updated_at: now,
  }

  db.prepare(
    `UPDATE workspaces
     SET name = ?, ui_lang = ?, preset = ?, updated_at = ?
     WHERE id = ?`,
  ).run(next.name, next.ui_lang, next.preset, now, id)

  return next
}

export function deleteWorkspace(db: Database.Database, id: string): void {
  // Cascade handles secrets, role_assignments, project_memory, iterations,
  // cost_records (per schema.sql ON DELETE CASCADE).
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
}

// ─── Secret CRUD (metadata only — keys live in OS keychain, Layer D) ──

export type CreateSecretInput = {
  workspace_id: string
  name: string
  provider: ProviderId
  base_url?: string
}

export function createSecret(
  db: Database.Database,
  input: CreateSecretInput,
): SecretMeta {
  const meta: SecretMeta = SecretMetaSchema.parse({
    id: randomUUID(),
    name: input.name,
    provider: input.provider,
    base_url: input.base_url ?? null,
    available_models: [],
    last_tested_at: null,
    created_at: Date.now(),
  })

  db.prepare(
    `INSERT INTO secrets
     (id, workspace_id, name, provider, base_url, available_models,
      last_tested_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    meta.id,
    input.workspace_id,
    meta.name,
    meta.provider,
    meta.base_url,
    JSON.stringify(meta.available_models),
    meta.last_tested_at,
    meta.created_at,
  )

  return meta
}

export function listSecrets(
  db: Database.Database,
  workspaceId: string,
): SecretMeta[] {
  const rows = db
    .prepare(
      `SELECT id, name, provider, base_url, available_models,
              last_tested_at, created_at
       FROM secrets WHERE workspace_id = ? ORDER BY created_at DESC`,
    )
    .all(workspaceId) as Array<Record<string, unknown> & { available_models: string }>
  return rows.map((r) =>
    SecretMetaSchema.parse({
      ...r,
      available_models: JSON.parse(r.available_models) as string[],
    }),
  )
}

export function getSecret(
  db: Database.Database,
  id: string,
): SecretMeta | null {
  const row = db
    .prepare(
      `SELECT id, name, provider, base_url, available_models,
              last_tested_at, created_at
       FROM secrets WHERE id = ?`,
    )
    .get(id) as (Record<string, unknown> & { available_models: string }) | undefined
  if (!row) return null
  return SecretMetaSchema.parse({
    ...row,
    available_models: JSON.parse(row.available_models) as string[],
  })
}

export function updateSecretAfterTest(
  db: Database.Database,
  id: string,
  available_models: string[],
): void {
  db.prepare(
    `UPDATE secrets SET available_models = ?, last_tested_at = ? WHERE id = ?`,
  ).run(JSON.stringify(available_models), Date.now(), id)
}

export function deleteSecret(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM secrets WHERE id = ?').run(id)
}

// ─── RoleAssignment CRUD ────────────────────────────────────────────

export function getRoleAssignments(
  db: Database.Database,
  workspaceId: string,
): Record<RoleType, RoleAssignment> {
  const rows = db
    .prepare('SELECT * FROM role_assignments WHERE workspace_id = ?')
    .all(workspaceId) as Record<string, unknown>[]

  const out: Partial<Record<RoleType, RoleAssignment>> = {}
  for (const r of rows) {
    const parsed = RoleAssignmentSchema.parse(r)
    out[parsed.role] = parsed
  }
  // Fill in any missing roles with empty assignments (defensive).
  for (const role of ALL_ROLES) {
    if (!out[role]) {
      out[role] = {
        role,
        secret_id: null,
        model_id: null,
        fallback_secret_id: null,
        fallback_model_id: null,
        custom_prompt_override: null,
      }
    }
  }
  return out as Record<RoleType, RoleAssignment>
}

export type SetRoleAssignmentInput = {
  workspace_id: string
  role: RoleType
  secret_id: string | null
  model_id: string | null
  fallback_secret_id?: string | null
  fallback_model_id?: string | null
  custom_prompt_override?: string | null
}

export function setRoleAssignment(
  db: Database.Database,
  input: SetRoleAssignmentInput,
): RoleAssignment {
  const a: RoleAssignment = RoleAssignmentSchema.parse({
    role: input.role,
    secret_id: input.secret_id,
    model_id: input.model_id,
    fallback_secret_id: input.fallback_secret_id ?? null,
    fallback_model_id: input.fallback_model_id ?? null,
    custom_prompt_override: input.custom_prompt_override ?? null,
  })

  db.prepare(
    `UPDATE role_assignments
     SET secret_id = ?, model_id = ?,
         fallback_secret_id = ?, fallback_model_id = ?,
         custom_prompt_override = ?
     WHERE workspace_id = ? AND role = ?`,
  ).run(
    a.secret_id,
    a.model_id,
    a.fallback_secret_id,
    a.fallback_model_id,
    a.custom_prompt_override,
    input.workspace_id,
    a.role,
  )

  return a
}

// ─── Hydrated workspace (for the UI to render in one fetch) ──────────

export function getHydratedWorkspace(
  db: Database.Database,
  id: string,
): HydratedWorkspace | null {
  const ws = getWorkspace(db, id)
  if (!ws) return null
  return {
    ...ws,
    secrets: listSecrets(db, id),
    role_assignments: getRoleAssignments(db, id),
  }
}
