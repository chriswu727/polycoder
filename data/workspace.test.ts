import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './connection.js'
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  createSecret,
  listSecrets,
  getSecret,
  updateSecretAfterTest,
  deleteSecret,
  getRoleAssignments,
  setRoleAssignment,
  getHydratedWorkspace,
} from './workspace.js'
import { ALL_ROLES } from '@core/types/role.js'

let db: Database.Database
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-ws-'))
  db = openDatabase(join(tmpDir, 'test.db'))
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('Workspace CRUD', () => {
  it('createWorkspace returns a valid record with seeded role assignments and memory', () => {
    const ws = createWorkspace(db, {
      name: 'Test Project',
      workspace_root: '/tmp/proj',
    })
    expect(ws.name).toBe('Test Project')
    expect(ws.ui_lang).toBe('zh-CN')
    expect(ws.preset).toBe('custom')

    const assignments = getRoleAssignments(db, ws.id)
    for (const role of ALL_ROLES) {
      expect(assignments[role].secret_id).toBeNull()
    }

    const memRow = db
      .prepare('SELECT memory_json FROM project_memory WHERE workspace_id = ?')
      .get(ws.id) as { memory_json: string } | undefined
    expect(memRow).toBeDefined()
    const mem = JSON.parse(memRow!.memory_json) as { workspace_id: string }
    expect(mem.workspace_id).toBe(ws.id)
  })

  it('getWorkspace returns null for missing id', () => {
    const result = getWorkspace(db, '00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('listWorkspaces orders by updated_at DESC', () => {
    const a = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    // Tiny pause to ensure distinct timestamps; both fit in same ms otherwise.
    db.prepare('UPDATE workspaces SET updated_at = updated_at + 1000 WHERE id = ?').run(a.id)
    const b = createWorkspace(db, { name: 'B', workspace_root: '/b' })
    const list = listWorkspaces(db)
    expect(list).toHaveLength(2)
    expect(list[0]?.id).toBe(a.id)
    expect(list[1]?.id).toBe(b.id)
  })

  it('updateWorkspace applies a patch and bumps updated_at', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const before = ws.updated_at
    // Wait one tick to ensure timestamp moves forward.
    const updated = updateWorkspace(db, ws.id, {
      name: 'A renamed',
      ui_lang: 'en',
    })
    expect(updated.name).toBe('A renamed')
    expect(updated.ui_lang).toBe('en')
    expect(updated.updated_at).toBeGreaterThanOrEqual(before)
  })

  it('deleteWorkspace cascades to secrets and assignments', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    createSecret(db, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'deepseek',
    })

    deleteWorkspace(db, ws.id)
    expect(getWorkspace(db, ws.id)).toBeNull()
    expect(listSecrets(db, ws.id)).toHaveLength(0)
  })
})

describe('Secret CRUD', () => {
  it('create + list + get + delete round-trip', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const s = createSecret(db, {
      workspace_id: ws.id,
      name: 'my-deepseek',
      provider: 'deepseek',
      base_url: 'https://api.deepseek.com',
    })
    expect(s.name).toBe('my-deepseek')
    expect(s.provider).toBe('deepseek')

    const list = listSecrets(db, ws.id)
    expect(list).toHaveLength(1)

    const got = getSecret(db, s.id)
    expect(got?.name).toBe('my-deepseek')

    deleteSecret(db, s.id)
    expect(getSecret(db, s.id)).toBeNull()
  })

  it('updateSecretAfterTest stores model list and last_tested_at', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const s = createSecret(db, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'deepseek',
    })
    expect(s.last_tested_at).toBeNull()
    expect(s.available_models).toHaveLength(0)

    updateSecretAfterTest(db, s.id, ['deepseek-chat', 'deepseek-coder'])

    const after = getSecret(db, s.id)
    expect(after?.available_models).toEqual(['deepseek-chat', 'deepseek-coder'])
    expect(after?.last_tested_at).not.toBeNull()
  })
})

describe('RoleAssignment', () => {
  it('setRoleAssignment writes through and reads back', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const s = createSecret(db, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'deepseek',
    })

    setRoleAssignment(db, {
      workspace_id: ws.id,
      role: 'coder',
      secret_id: s.id,
      model_id: 'deepseek-coder',
    })

    const assignments = getRoleAssignments(db, ws.id)
    expect(assignments.coder.secret_id).toBe(s.id)
    expect(assignments.coder.model_id).toBe('deepseek-coder')
    // Other roles still null.
    expect(assignments.translator.secret_id).toBeNull()
  })

  it('deleting a secret nulls out role_assignments referencing it (ON DELETE SET NULL)', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const s = createSecret(db, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'deepseek',
    })
    setRoleAssignment(db, {
      workspace_id: ws.id,
      role: 'coder',
      secret_id: s.id,
      model_id: 'deepseek-coder',
    })

    deleteSecret(db, s.id)

    const assignments = getRoleAssignments(db, ws.id)
    expect(assignments.coder.secret_id).toBeNull()
  })
})

describe('getHydratedWorkspace', () => {
  it('returns workspace + secrets + assignments in one call', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    createSecret(db, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'deepseek',
    })
    const hydrated = getHydratedWorkspace(db, ws.id)
    expect(hydrated).not.toBeNull()
    expect(hydrated?.secrets).toHaveLength(1)
    expect(Object.keys(hydrated!.role_assignments)).toHaveLength(8)
  })

  it('returns null for missing workspace', () => {
    expect(
      getHydratedWorkspace(db, '00000000-0000-0000-0000-000000000000'),
    ).toBeNull()
  })
})
