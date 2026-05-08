// Workspace IPC handlers — main side. See SPEC.md §6 for the UI flow.
// Pure functions of (db, request) → response so the renderer's
// IPC layer (preload + ipcMain.handle) is the only Electron-coupled part.

import type Database from 'better-sqlite3'
import {
  createWorkspace as createWorkspaceData,
  listWorkspaces,
  deleteWorkspace as deleteWorkspaceData,
  setRoleAssignment as setRoleAssignmentData,
  getHydratedWorkspace,
} from '../../data/workspace.js'
import type {
  Workspace,
  HydratedWorkspace,
  PresetId,
  ProviderId,
} from '@core/types/workspace.js'
import type { RoleType } from '@core/types/role.js'

// ─── Workspace CRUD ────────────────────────────────────────────────

export type CreateWorkspaceRequest = {
  name: string
  workspace_root: string
  ui_lang?: 'zh-CN' | 'en'
  preset?: PresetId
}

export type CreateWorkspaceResponse =
  | { ok: true; workspace: Workspace }
  | { ok: false; error: string }

export function handleCreateWorkspace(
  db: Database.Database,
  req: CreateWorkspaceRequest,
): CreateWorkspaceResponse {
  try {
    const ws = createWorkspaceData(db, {
      name: req.name,
      workspace_root: req.workspace_root,
      ...(req.ui_lang !== undefined ? { ui_lang: req.ui_lang } : {}),
      ...(req.preset !== undefined ? { preset: req.preset } : {}),
    })
    return { ok: true, workspace: ws }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export type ListWorkspacesResponse = Workspace[]

export function handleListWorkspaces(db: Database.Database): ListWorkspacesResponse {
  return listWorkspaces(db)
}

export type GetWorkspaceRequest = { id: string }
export type GetWorkspaceResponse = HydratedWorkspace | null

export function handleGetWorkspace(
  db: Database.Database,
  req: GetWorkspaceRequest,
): GetWorkspaceResponse {
  return getHydratedWorkspace(db, req.id)
}

export type DeleteWorkspaceRequest = { id: string }
export type DeleteWorkspaceResponse = { ok: true }

export function handleDeleteWorkspace(
  db: Database.Database,
  req: DeleteWorkspaceRequest,
): DeleteWorkspaceResponse {
  deleteWorkspaceData(db, req.id)
  return { ok: true }
}

// ─── Role assignments ──────────────────────────────────────────────

export type SetRoleAssignmentRequest = {
  workspace_id: string
  role: RoleType
  secret_id: string | null
  model_id: string | null
  fallback_secret_id?: string | null
  fallback_model_id?: string | null
  custom_prompt_override?: string | null
}

export type SetRoleAssignmentResponse = { ok: true }

export function handleSetRoleAssignment(
  db: Database.Database,
  req: SetRoleAssignmentRequest,
): SetRoleAssignmentResponse {
  setRoleAssignmentData(db, {
    workspace_id: req.workspace_id,
    role: req.role,
    secret_id: req.secret_id,
    model_id: req.model_id,
    fallback_secret_id: req.fallback_secret_id ?? null,
    fallback_model_id: req.fallback_model_id ?? null,
    custom_prompt_override: req.custom_prompt_override ?? null,
  })
  return { ok: true }
}

// ─── Preset application ────────────────────────────────────────────

export type ApplyPresetRequest = {
  workspace_id: string
  preset: PresetId
}

export type ApplyPresetResponse = { ok: true; assignments_set: number }

/**
 * Apply a preset by mapping each role to a (provider, model) pair
 * using whichever secrets the workspace already has for the relevant
 * providers. Roles whose required provider isn't configured are
 * left unconfigured (secret_id = null).
 */
export function handleApplyPreset(
  db: Database.Database,
  req: ApplyPresetRequest,
): ApplyPresetResponse {
  const hydrated = getHydratedWorkspace(db, req.workspace_id)
  if (!hydrated) throw new Error(`Workspace not found: ${req.workspace_id}`)

  const preset = PRESET_DEFINITIONS[req.preset]
  if (!preset) throw new Error(`Unknown preset: ${req.preset}`)

  let count = 0
  for (const role of Object.keys(preset) as RoleType[]) {
    const want = preset[role]
    if (!want) continue
    const matchingSecret = hydrated.secrets.find((s) => s.provider === want.provider)
    setRoleAssignmentData(db, {
      workspace_id: req.workspace_id,
      role,
      secret_id: matchingSecret?.id ?? null,
      model_id: matchingSecret ? want.model : null,
      fallback_secret_id: null,
      fallback_model_id: null,
      custom_prompt_override: null,
    })
    if (matchingSecret) count++
  }
  return { ok: true, assignments_set: count }
}

// ─── Preset definitions ────────────────────────────────────────────
// Maps each role to a (preferred_provider, default_model) pair per
// preset. See SPEC.md §7.

type RoleToProviderModel = Partial<
  Record<RoleType, { provider: ProviderId; model: string }>
>

export const PRESET_DEFINITIONS: Record<PresetId, RoleToProviderModel> = {
  budget: {
    translator: { provider: 'deepseek', model: 'deepseek-chat' },
    designer: { provider: 'glm', model: 'glm-4-flash' },
    architect: { provider: 'deepseek', model: 'deepseek-chat' },
    coder: { provider: 'deepseek', model: 'deepseek-coder' },
    adversary: { provider: 'glm', model: 'glm-4-plus' },
    long_term_critic: { provider: 'deepseek', model: 'deepseek-chat' },
    test_runner: { provider: 'deepseek', model: 'deepseek-chat' },
    communicator: { provider: 'glm', model: 'glm-4-flash' },
  },
  china_pro: {
    translator: { provider: 'deepseek', model: 'deepseek-chat' },
    designer: { provider: 'glm', model: 'glm-4-plus' },
    architect: { provider: 'qwen', model: 'qwen-max' },
    coder: { provider: 'deepseek', model: 'deepseek-coder' },
    adversary: { provider: 'qwen', model: 'qwen-max' },
    long_term_critic: { provider: 'qwen', model: 'qwen-max' },
    test_runner: { provider: 'deepseek', model: 'deepseek-chat' },
    communicator: { provider: 'glm', model: 'glm-4-flash' },
  },
  mixed: {
    translator: { provider: 'deepseek', model: 'deepseek-chat' },
    designer: { provider: 'anthropic', model: 'claude-sonnet-4-6-20251022' },
    architect: { provider: 'anthropic', model: 'claude-opus-4-7-20260101' },
    coder: { provider: 'anthropic', model: 'claude-sonnet-4-6-20251022' },
    adversary: { provider: 'anthropic', model: 'claude-opus-4-7-20260101' },
    long_term_critic: { provider: 'anthropic', model: 'claude-opus-4-7-20260101' },
    test_runner: { provider: 'deepseek', model: 'deepseek-chat' },
    communicator: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  },
  custom: {
    // Empty by design: 'custom' means the user wires it manually.
  },
}
