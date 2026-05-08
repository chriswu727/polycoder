// Workspace store — holds the currently-selected workspace + its
// secrets + role assignments + the list of all workspaces. Wraps
// the IPC API so components don't talk to window.polycoder.* directly.

import { create } from 'zustand'
import type {
  Workspace,
  SecretMeta,
  RoleAssignment,
  ProviderId,
  PresetId,
} from '@core/types/workspace.js'
import type { RoleType } from '@core/types/role.js'
import type { TestConnectionResult } from '@providers/ModelProvider.js'

export type WorkspaceStoreState = {
  // ─── Reactive data ─────────────────────────────
  workspaces: Workspace[]
  current: Workspace | null
  secrets: SecretMeta[]
  roleAssignments: Record<RoleType, RoleAssignment> | null
  loading: boolean
  error: string | null

  // ─── Actions ──────────────────────────────────
  refreshWorkspaces: () => Promise<void>
  createWorkspace: (name: string, root: string) => Promise<Workspace>
  selectWorkspace: (id: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>

  refreshSecrets: () => Promise<void>
  addSecret: (input: {
    name: string
    provider: ProviderId
    api_key: string
    base_url?: string
  }) => Promise<{ ok: boolean; error?: string }>
  removeSecret: (secret_id: string) => Promise<void>
  testSecret: (secret_id: string) => Promise<TestConnectionResult>

  setRoleAssignment: (
    role: RoleType,
    secret_id: string | null,
    model_id: string | null,
  ) => Promise<void>
  applyPreset: (preset: PresetId) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  workspaces: [],
  current: null,
  secrets: [],
  roleAssignments: null,
  loading: false,
  error: null,

  async refreshWorkspaces() {
    set({ loading: true, error: null })
    try {
      const list = await window.polycoder.workspace.list()
      set({ workspaces: list, loading: false })
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        loading: false,
      })
    }
  },

  async createWorkspace(name, root) {
    set({ loading: true, error: null })
    const result = await window.polycoder.workspace.create({
      name,
      workspace_root: root,
    })
    if (!result.ok) {
      set({ error: result.error, loading: false })
      throw new Error(result.error)
    }
    await get().refreshWorkspaces()
    await get().selectWorkspace(result.workspace.id)
    set({ loading: false })
    return result.workspace
  },

  async selectWorkspace(id) {
    set({ loading: true, error: null })
    const hydrated = await window.polycoder.workspace.get({ id })
    if (!hydrated) {
      set({ error: 'workspace not found', loading: false })
      return
    }
    // HydratedWorkspace = Workspace & { secrets, role_assignments }.
    // Pull the workspace columns off the front for `current` so the
    // store reflects the canonical Workspace shape.
    const {
      secrets: secretsList,
      role_assignments,
      ...workspace
    } = hydrated
    set({
      current: workspace,
      secrets: secretsList,
      roleAssignments: role_assignments,
      loading: false,
    })
  },

  async deleteWorkspace(id) {
    await window.polycoder.workspace.delete({ id })
    if (get().current?.id === id) {
      set({ current: null, secrets: [], roleAssignments: null })
    }
    await get().refreshWorkspaces()
  },

  async refreshSecrets() {
    const ws = get().current
    if (!ws) return
    const list = await window.polycoder.secrets.list({ workspace_id: ws.id })
    set({ secrets: list })
  },

  async addSecret(input) {
    const ws = get().current
    if (!ws) throw new Error('no workspace selected')
    const result = await window.polycoder.secrets.add({
      workspace_id: ws.id,
      ...input,
    })
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    await get().refreshSecrets()
    return { ok: true }
  },

  async removeSecret(secret_id) {
    const ws = get().current
    if (!ws) return
    await window.polycoder.secrets.remove({
      workspace_id: ws.id,
      secret_id,
    })
    await get().refreshSecrets()
  },

  async testSecret(secret_id) {
    const ws = get().current
    if (!ws) throw new Error('no workspace selected')
    const result = await window.polycoder.secrets.test({
      workspace_id: ws.id,
      secret_id,
    })
    // Refresh metadata so available_models / last_tested_at update.
    await get().refreshSecrets()
    return result
  },

  async setRoleAssignment(role, secret_id, model_id) {
    const ws = get().current
    if (!ws) return
    await window.polycoder.roles.setAssignment({
      workspace_id: ws.id,
      role,
      secret_id,
      model_id,
    })
    // Re-select to refresh assignments.
    await get().selectWorkspace(ws.id)
  },

  async applyPreset(preset) {
    const ws = get().current
    if (!ws) return
    await window.polycoder.roles.applyPreset({
      workspace_id: ws.id,
      preset,
    })
    await get().selectWorkspace(ws.id)
  },
}))
