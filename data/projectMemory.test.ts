import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openDatabase } from './connection.js'
import { createWorkspace } from './workspace.js'
import {
  getProjectMemory,
  saveProjectMemory,
  applyMemoryUpdate,
  markTechDebtResolved,
} from './projectMemory.js'

let db: Database.Database
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-mem-'))
  db = openDatabase(join(tmpDir, 'test.db'))
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('Project memory CRUD', () => {
  it('createWorkspace seeds empty project memory', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const mem = getProjectMemory(db, ws.id)
    expect(mem).not.toBeNull()
    expect(mem?.workspace_id).toBe(ws.id)
    expect(mem?.decisions).toHaveLength(0)
    expect(mem?.conventions).toHaveLength(0)
  })

  it('saveProjectMemory persists the snapshot', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const mem = getProjectMemory(db, ws.id)!
    mem.conventions.push({
      id: randomUUID(),
      convention: 'PascalCase for components',
      scope: 'global',
      added_in_iteration: 1,
      added_at: Date.now(),
    })
    saveProjectMemory(db, mem)

    const reloaded = getProjectMemory(db, ws.id)!
    expect(reloaded.conventions).toHaveLength(1)
    expect(reloaded.conventions[0]?.convention).toBe('PascalCase for components')
  })

  it('returns null for missing workspace', () => {
    const mem = getProjectMemory(db, '00000000-0000-0000-0000-000000000000')
    expect(mem).toBeNull()
  })
})

describe('applyMemoryUpdate', () => {
  it('adds decisions, conventions, components, tech debt', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const result = applyMemoryUpdate(
      db,
      { workspace_id: ws.id, iteration_number: 1 },
      {
        add_decisions: [
          { decision: 'use SQLite', rationale: 'simplicity' },
        ],
        add_conventions: [
          { convention: 'PascalCase', scope: 'global' },
        ],
        add_components: [
          { name: 'TaskItem', path: 'src/components/TaskItem.tsx', purpose: 'one task row' },
        ],
        add_tech_debt: [
          {
            file: 'src/store.ts',
            issue: 'no error handling on quota exceeded',
            severity: 'medium',
            introduced_by_role: 'coder',
          },
        ],
      },
    )

    expect(result).toEqual({
      decisions_added: 1,
      conventions_added: 1,
      components_added: 1,
      tech_debt_added: 1,
      superseded: 0,
      design_tokens_set: false,
    })

    const mem = getProjectMemory(db, ws.id)!
    expect(mem.decisions).toHaveLength(1)
    expect(mem.decisions[0]?.decision).toBe('use SQLite')
    expect(mem.decisions[0]?.added_in_iteration).toBe(1)
    expect(mem.tech_debt[0]?.severity).toBe('medium')
  })

  it('iteration_number defaults to ctx when not provided', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    applyMemoryUpdate(
      db,
      { workspace_id: ws.id, iteration_number: 7 },
      {
        add_decisions: [{ decision: 'x', rationale: 'y' }],
      },
    )
    const mem = getProjectMemory(db, ws.id)!
    expect(mem.decisions[0]?.added_in_iteration).toBe(7)
  })

  it('supersedes a decision: old gets superseded_by, new gets supersedes', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    applyMemoryUpdate(
      db,
      { workspace_id: ws.id, iteration_number: 1 },
      {
        add_decisions: [
          { decision: 'use SQLite for V1', rationale: 'no backend' },
        ],
      },
    )
    const before = getProjectMemory(db, ws.id)!
    const oldId = before.decisions[0]!.id

    applyMemoryUpdate(
      db,
      { workspace_id: ws.id, iteration_number: 3 },
      {
        supersede_decisions: [
          {
            old_decision_id: oldId,
            new_decision: {
              decision: 'use Postgres',
              rationale: 'multi-user requires it',
            },
          },
        ],
      },
    )

    const after = getProjectMemory(db, ws.id)!
    expect(after.decisions).toHaveLength(2)
    const oldDec = after.decisions.find((d) => d.id === oldId)!
    expect(oldDec.superseded_by).not.toBeNull()
    const newDec = after.decisions.find((d) => d.supersedes === oldId)!
    expect(newDec.decision).toBe('use Postgres')
    expect(oldDec.superseded_by).toBe(newDec.id)
  })

  it('throws if superseded decision id is unknown', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    expect(() =>
      applyMemoryUpdate(
        db,
        { workspace_id: ws.id, iteration_number: 1 },
        {
          supersede_decisions: [
            {
              old_decision_id: '00000000-0000-0000-0000-000000000000',
              new_decision: { decision: 'x', rationale: 'y' },
            },
          ],
        },
      ),
    ).toThrow(/old_decision_id not found/)
  })

  it('sets design tokens', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const result = applyMemoryUpdate(
      db,
      { workspace_id: ws.id, iteration_number: 1 },
      {
        set_design_tokens: {
          colors: { primary: '#2563eb' },
          typography: { font_family: 'system-ui', scale: ['14px', '16px'] },
          spacing: { unit: '4px', scale: [4, 8, 16] },
          established_in_iteration: 1,
        },
      },
    )
    expect(result.design_tokens_set).toBe(true)
    const mem = getProjectMemory(db, ws.id)!
    expect(mem.design_tokens.colors.primary).toBe('#2563eb')
  })

  it('all updates run atomically: failure rolls back partial work', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    expect(() =>
      applyMemoryUpdate(
        db,
        { workspace_id: ws.id, iteration_number: 1 },
        {
          add_decisions: [{ decision: 'x', rationale: 'y' }],
          supersede_decisions: [
            {
              old_decision_id: '00000000-0000-0000-0000-000000000000',
              new_decision: { decision: 'z', rationale: 'w' },
            },
          ],
        },
      ),
    ).toThrow()

    const mem = getProjectMemory(db, ws.id)!
    expect(mem.decisions).toHaveLength(0) // the add_decisions partial was rolled back
  })
})

describe('markTechDebtResolved', () => {
  it('flips resolved + sets resolved_in_iteration', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    applyMemoryUpdate(
      db,
      { workspace_id: ws.id, iteration_number: 1 },
      {
        add_tech_debt: [
          {
            file: 'src/x.ts',
            issue: 'something',
            severity: 'low',
            introduced_by_role: 'coder',
          },
        ],
      },
    )
    const mem = getProjectMemory(db, ws.id)!
    const debtId = mem.tech_debt[0]!.id

    markTechDebtResolved(db, ws.id, debtId, 5)

    const after = getProjectMemory(db, ws.id)!
    expect(after.tech_debt[0]?.resolved).toBe(true)
    expect(after.tech_debt[0]?.resolved_in_iteration).toBe(5)
  })
})
