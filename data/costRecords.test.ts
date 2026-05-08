import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './connection.js'
import { createWorkspace } from './workspace.js'
import { startIteration } from './iterations.js'
import {
  appendCostRecord,
  totalsByIteration,
  totalsByWorkspace,
  totalsByModel,
  totalsByRole,
  listCostRecordsForIteration,
} from './costRecords.js'

let db: Database.Database
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-cost-'))
  db = openDatabase(join(tmpDir, 'test.db'))
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

function setup() {
  const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
  const it = startIteration(db, { workspace_id: ws.id, user_prompt: 'p' })
  return { ws, it }
}

describe('appendCostRecord', () => {
  it('persists a single record', () => {
    const { ws, it } = setup()
    const r = appendCostRecord(db, {
      workspace_id: ws.id,
      iteration_id: it.id,
      role: 'translator',
      provider: 'deepseek',
      model: 'deepseek-chat',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 0,
        total_tokens: 150,
        estimated_cost_usd: 0.001,
      },
      duration_ms: 1234,
    })
    expect(r.input_tokens).toBe(100)
    expect(r.output_tokens).toBe(50)

    const list = listCostRecordsForIteration(db, it.id)
    expect(list).toHaveLength(1)
  })
})

describe('Aggregates', () => {
  it('totalsByIteration sums correctly across roles', () => {
    const { ws, it } = setup()

    appendCostRecord(db, {
      workspace_id: ws.id,
      iteration_id: it.id,
      role: 'translator',
      provider: 'deepseek',
      model: 'deepseek-chat',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cached_input_tokens: 0,
        total_tokens: 120,
        estimated_cost_usd: 0.001,
      },
      duration_ms: 1000,
    })
    appendCostRecord(db, {
      workspace_id: ws.id,
      iteration_id: it.id,
      role: 'coder',
      provider: 'deepseek',
      model: 'deepseek-coder',
      usage: {
        input_tokens: 500,
        output_tokens: 800,
        cached_input_tokens: 200,
        total_tokens: 1300,
        estimated_cost_usd: 0.005,
      },
      duration_ms: 4000,
    })

    const totals = totalsByIteration(db, it.id)
    expect(totals.total_input_tokens).toBe(600)
    expect(totals.total_output_tokens).toBe(820)
    expect(totals.total_cached_input_tokens).toBe(200)
    expect(totals.total_cost_usd).toBeCloseTo(0.006, 6)
    expect(totals.call_count).toBe(2)
  })

  it('totalsByWorkspace sums across iterations', () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const it1 = startIteration(db, { workspace_id: ws.id, user_prompt: 'p1' })
    const it2 = startIteration(db, { workspace_id: ws.id, user_prompt: 'p2' })

    for (const it of [it1, it2]) {
      appendCostRecord(db, {
        workspace_id: ws.id,
        iteration_id: it.id,
        role: 'translator',
        provider: 'glm',
        model: 'glm-4-flash',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cached_input_tokens: 0,
          total_tokens: 150,
          estimated_cost_usd: 0.001,
        },
        duration_ms: 500,
      })
    }

    const ws_totals = totalsByWorkspace(db, ws.id)
    expect(ws_totals.call_count).toBe(2)
    expect(ws_totals.total_cost_usd).toBeCloseTo(0.002, 6)
  })

  it('totalsByModel groups by model id', () => {
    const { ws, it } = setup()

    appendCostRecord(db, {
      workspace_id: ws.id,
      iteration_id: it.id,
      role: 'translator',
      provider: 'deepseek',
      model: 'deepseek-chat',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 0,
        total_tokens: 150,
        estimated_cost_usd: 0.001,
      },
      duration_ms: 100,
    })
    appendCostRecord(db, {
      workspace_id: ws.id,
      iteration_id: it.id,
      role: 'coder',
      provider: 'deepseek',
      model: 'deepseek-coder',
      usage: {
        input_tokens: 200,
        output_tokens: 800,
        cached_input_tokens: 0,
        total_tokens: 1000,
        estimated_cost_usd: 0.004,
      },
      duration_ms: 200,
    })

    const m = totalsByModel(db, ws.id)
    expect(m.size).toBe(2)
    expect(m.get('deepseek-chat')?.total_cost_usd).toBeCloseTo(0.001, 6)
    expect(m.get('deepseek-coder')?.total_cost_usd).toBeCloseTo(0.004, 6)
  })

  it('totalsByRole groups by role', () => {
    const { ws, it } = setup()

    appendCostRecord(db, {
      workspace_id: ws.id,
      iteration_id: it.id,
      role: 'adversary',
      provider: 'qwen',
      model: 'qwen-max',
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cached_input_tokens: 0,
        total_tokens: 1200,
        estimated_cost_usd: 0.01,
      },
      duration_ms: 500,
    })
    appendCostRecord(db, {
      workspace_id: ws.id,
      iteration_id: it.id,
      role: 'communicator',
      provider: 'glm',
      model: 'glm-4-flash',
      usage: {
        input_tokens: 800,
        output_tokens: 100,
        cached_input_tokens: 0,
        total_tokens: 900,
        estimated_cost_usd: 0.0001,
      },
      duration_ms: 200,
    })

    const m = totalsByRole(db, ws.id)
    expect(m.size).toBe(2)
    expect(m.get('adversary')?.total_cost_usd).toBeCloseTo(0.01, 6)
    expect(m.get('communicator')?.total_cost_usd).toBeCloseTo(0.0001, 6)
  })

  it('returns zero aggregate for empty workspace', () => {
    const ws = createWorkspace(db, { name: 'empty', workspace_root: '/e' })
    const t = totalsByWorkspace(db, ws.id)
    expect(t.call_count).toBe(0)
    expect(t.total_cost_usd).toBe(0)
  })
})

describe('Cascade delete', () => {
  it('deleting iteration removes its cost records', () => {
    const { ws, it } = setup()
    appendCostRecord(db, {
      workspace_id: ws.id,
      iteration_id: it.id,
      role: 'translator',
      provider: 'deepseek',
      model: 'deepseek-chat',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 0,
        total_tokens: 150,
        estimated_cost_usd: 0.001,
      },
      duration_ms: 100,
    })
    expect(listCostRecordsForIteration(db, it.id)).toHaveLength(1)

    db.prepare('DELETE FROM iterations WHERE id = ?').run(it.id)

    expect(listCostRecordsForIteration(db, it.id)).toHaveLength(0)
  })
})
