import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './connection.js'
import { createWorkspace } from './workspace.js'
import {
  startIteration,
  finishIteration,
  getIteration,
  listIterations,
  deleteIteration,
} from './iterations.js'

let db: Database.Database
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-iter-'))
  db = openDatabase(join(tmpDir, 'test.db'))
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('startIteration', () => {
  it('starts iteration_number at 1 for a fresh workspace', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const it1 = startIteration(db, {
      workspace_id: ws.id,
      user_prompt: 'build a todo app',
    })
    expect(it1.iteration_number).toBe(1)
    expect(it1.status).toBe('running')
  })

  it('increments iteration_number monotonically', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const it1 = startIteration(db, { workspace_id: ws.id, user_prompt: 'p1' })
    const it2 = startIteration(db, { workspace_id: ws.id, user_prompt: 'p2' })
    const it3 = startIteration(db, { workspace_id: ws.id, user_prompt: 'p3' })
    expect(it1.iteration_number).toBe(1)
    expect(it2.iteration_number).toBe(2)
    expect(it3.iteration_number).toBe(3)
  })

  it('two workspaces have independent iteration_number sequences', () => {
    const a = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const b = createWorkspace(db, { name: 'B', workspace_root: '/b' })
    startIteration(db, { workspace_id: a.id, user_prompt: 'p' })
    startIteration(db, { workspace_id: a.id, user_prompt: 'p' })
    const bIt = startIteration(db, { workspace_id: b.id, user_prompt: 'p' })
    expect(bIt.iteration_number).toBe(1)
  })
})

describe('finishIteration', () => {
  it('updates status, traffic_light, cost, files, and computes duration_ms', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const it = startIteration(db, { workspace_id: ws.id, user_prompt: 'p' })

    const finished = finishIteration(db, {
      iteration_id: it.id,
      status: 'completed',
      traffic_light: 'green',
      total_cost_usd: 0.05,
      files_changed: ['src/App.tsx', 'src/store.ts'],
      role_outputs: {},
      conflicts: [],
    })

    expect(finished.status).toBe('completed')
    expect(finished.traffic_light).toBe('green')
    expect(finished.total_cost_usd).toBe(0.05)
    expect(finished.files_changed).toEqual(['src/App.tsx', 'src/store.ts'])
    expect(finished.duration_ms).not.toBeNull()
    expect(finished.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('throws on unknown iteration id', () => {
    expect(() =>
      finishIteration(db, {
        iteration_id: '00000000-0000-0000-0000-000000000000',
        status: 'completed',
        traffic_light: 'green',
        total_cost_usd: 0,
        files_changed: [],
        role_outputs: {},
        conflicts: [],
      }),
    ).toThrow(/not found/)
  })

  it('round-trips role_outputs and conflicts JSON', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const it = startIteration(db, { workspace_id: ws.id, user_prompt: 'p' })

    finishIteration(db, {
      iteration_id: it.id,
      status: 'completed',
      traffic_light: 'yellow',
      total_cost_usd: 0.02,
      files_changed: [],
      role_outputs: {
        translator: {
          role: 'translator',
          iteration: 1,
          model: 'deepseek-chat',
          status: 'ok',
          summary: 'simple todo app',
          payload: { intent_summary: 'todo app' },
        },
      },
      conflicts: [
        {
          id: 'CONFLICT-1-001',
          type: 'adversary_flagged_test_passed',
          involved_roles: ['adversary', 'test_runner'],
          severity: 'high',
          description: 'adversary found XSS, tests passed',
          user_action_required: true,
        },
      ],
    })

    const reloaded = getIteration(db, it.id)!
    const outputs = JSON.parse(reloaded.role_outputs_json) as Record<
      string,
      { summary: string }
    >
    expect(outputs.translator?.summary).toBe('simple todo app')
    const conflicts = JSON.parse(reloaded.conflicts_json) as Array<{
      id: string
    }>
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.id).toBe('CONFLICT-1-001')
  })
})

describe('listIterations', () => {
  it('returns summaries newest-first by iteration_number', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    startIteration(db, { workspace_id: ws.id, user_prompt: 'p1' })
    startIteration(db, { workspace_id: ws.id, user_prompt: 'p2' })
    startIteration(db, { workspace_id: ws.id, user_prompt: 'p3' })

    const list = listIterations(db, ws.id)
    expect(list).toHaveLength(3)
    expect(list[0]?.iteration_number).toBe(3)
    expect(list[1]?.iteration_number).toBe(2)
    expect(list[2]?.iteration_number).toBe(1)
  })

  it('respects limit + offset', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    for (let i = 0; i < 5; i++) {
      startIteration(db, { workspace_id: ws.id, user_prompt: `p${i}` })
    }
    const page1 = listIterations(db, ws.id, { limit: 2, offset: 0 })
    const page2 = listIterations(db, ws.id, { limit: 2, offset: 2 })
    expect(page1).toHaveLength(2)
    expect(page2).toHaveLength(2)
    expect(page1[0]?.iteration_number).toBe(5)
    expect(page2[0]?.iteration_number).toBe(3)
  })

  it('returns empty for unknown workspace', () => {
    expect(
      listIterations(db, '00000000-0000-0000-0000-000000000000'),
    ).toEqual([])
  })
})

describe('deleteIteration', () => {
  it('removes the iteration', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const it = startIteration(db, { workspace_id: ws.id, user_prompt: 'p' })
    deleteIteration(db, it.id)
    expect(getIteration(db, it.id)).toBeNull()
  })
})
