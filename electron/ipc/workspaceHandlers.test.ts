import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../data/connection.js'
import { InMemoryKeystore } from '../secrets/keystore.js'
import { addSecret } from '../../data/secrets.js'
import {
  handleCreateWorkspace,
  handleListWorkspaces,
  handleGetWorkspace,
  handleDeleteWorkspace,
  handleSetRoleAssignment,
  handleApplyPreset,
  PRESET_DEFINITIONS,
} from './workspaceHandlers.js'
import { ALL_ROLES } from '@core/types/role.js'

let db: Database.Database
let dbDir: string
let keystore: InMemoryKeystore

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-ws-ipc-'))
  db = openDatabase(join(dbDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(dbDir, { recursive: true, force: true })
})

describe('handleCreateWorkspace', () => {
  it('returns ok with the new workspace', () => {
    const r = handleCreateWorkspace(db, {
      name: 'A',
      workspace_root: '/tmp/a',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.workspace.name).toBe('A')
  })

  it('returns ok:false on validation error (empty name)', () => {
    const r = handleCreateWorkspace(db, {
      name: '',
      workspace_root: '/tmp/a',
    })
    expect(r.ok).toBe(false)
  })
})

describe('handleListWorkspaces / handleGetWorkspace / handleDeleteWorkspace', () => {
  it('round-trips through list / get / delete', () => {
    const created = handleCreateWorkspace(db, {
      name: 'X',
      workspace_root: '/tmp/x',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(handleListWorkspaces(db)).toHaveLength(1)

    const hydrated = handleGetWorkspace(db, { id: created.workspace.id })
    expect(hydrated).not.toBeNull()
    expect(hydrated?.id).toBe(created.workspace.id)
    expect(Object.keys(hydrated!.role_assignments)).toHaveLength(8)

    handleDeleteWorkspace(db, { id: created.workspace.id })
    expect(handleListWorkspaces(db)).toHaveLength(0)
  })

  it('handleGetWorkspace returns null for missing id', () => {
    expect(
      handleGetWorkspace(db, { id: '00000000-0000-0000-0000-000000000000' }),
    ).toBeNull()
  })
})

describe('handleSetRoleAssignment', () => {
  it('persists a role-secret-model triple', async () => {
    const ws = handleCreateWorkspace(db, { name: 'A', workspace_root: '/tmp/a' })
    if (!ws.ok) throw new Error('failed setup')
    const sec = await addSecret(db, keystore, {
      workspace_id: ws.workspace.id,
      name: 'k',
      provider: 'deepseek',
      api_key: 'sk',
    })

    handleSetRoleAssignment(db, {
      workspace_id: ws.workspace.id,
      role: 'coder',
      secret_id: sec.id,
      model_id: 'deepseek-coder',
    })

    const hydrated = handleGetWorkspace(db, { id: ws.workspace.id })!
    expect(hydrated.role_assignments.coder.secret_id).toBe(sec.id)
    expect(hydrated.role_assignments.coder.model_id).toBe('deepseek-coder')
  })
})

describe('handleApplyPreset', () => {
  it('budget preset assigns DeepSeek for most roles when DeepSeek key present', async () => {
    const ws = handleCreateWorkspace(db, { name: 'A', workspace_root: '/tmp/a' })
    if (!ws.ok) throw new Error('failed setup')
    await addSecret(db, keystore, {
      workspace_id: ws.workspace.id,
      name: 'ds',
      provider: 'deepseek',
      api_key: 'sk',
    })
    await addSecret(db, keystore, {
      workspace_id: ws.workspace.id,
      name: 'glm',
      provider: 'glm',
      api_key: 'sk',
    })

    const result = handleApplyPreset(db, {
      workspace_id: ws.workspace.id,
      preset: 'budget',
    })
    expect(result.ok).toBe(true)
    expect(result.assignments_set).toBeGreaterThanOrEqual(6)

    const hydrated = handleGetWorkspace(db, { id: ws.workspace.id })!
    // Coder gets deepseek-coder (the budget preset specifies it)
    expect(hydrated.role_assignments.coder.model_id).toBe('deepseek-coder')
    // Translator gets deepseek-chat
    expect(hydrated.role_assignments.translator.model_id).toBe('deepseek-chat')
    // Communicator gets glm-4-flash
    expect(hydrated.role_assignments.communicator.model_id).toBe('glm-4-flash')
  })

  it('roles are left unconfigured (secret_id:null) when their preset provider has no key', async () => {
    const ws = handleCreateWorkspace(db, { name: 'A', workspace_root: '/tmp/a' })
    if (!ws.ok) throw new Error('failed setup')
    // Only deepseek key — preset wants GLM for some roles
    await addSecret(db, keystore, {
      workspace_id: ws.workspace.id,
      name: 'ds',
      provider: 'deepseek',
      api_key: 'sk',
    })

    handleApplyPreset(db, {
      workspace_id: ws.workspace.id,
      preset: 'budget',
    })

    const hydrated = handleGetWorkspace(db, { id: ws.workspace.id })!
    expect(hydrated.role_assignments.coder.secret_id).not.toBeNull()
    // Designer wants GLM in budget preset → no GLM key → unconfigured
    expect(hydrated.role_assignments.designer.secret_id).toBeNull()
    expect(hydrated.role_assignments.designer.model_id).toBeNull()
  })

  it('custom preset clears nothing (it is a no-op by design)', async () => {
    const ws = handleCreateWorkspace(db, { name: 'A', workspace_root: '/tmp/a' })
    if (!ws.ok) throw new Error('failed setup')
    const result = handleApplyPreset(db, {
      workspace_id: ws.workspace.id,
      preset: 'custom',
    })
    expect(result.ok).toBe(true)
    expect(result.assignments_set).toBe(0)
  })
})

describe('PRESET_DEFINITIONS', () => {
  it('budget / china_pro / mixed all cover every role', () => {
    for (const preset of ['budget', 'china_pro', 'mixed'] as const) {
      const def = PRESET_DEFINITIONS[preset]
      for (const role of ALL_ROLES) {
        expect(def[role]).toBeDefined()
      }
    }
  })

  it('custom is empty', () => {
    expect(Object.keys(PRESET_DEFINITIONS.custom)).toHaveLength(0)
  })
})
