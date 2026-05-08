import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { openDatabase } from '../data/connection.js'
import { createWorkspace } from '../data/workspace.js'
import { startIteration, finishIteration } from '../data/iterations.js'
import { InMemoryKeystore } from '../electron/secrets/keystore.js'
import { readProjectMemoryTool } from './readProjectMemory.js'
import { updateProjectMemoryTool } from './updateProjectMemory.js'
import { readHistoryTool } from './readHistory.js'
import { readDesignTokensTool } from './readDesignTokens.js'
import type { ToolContext } from './ToolDef.js'
import type { RoleType } from '@core/types/role.js'

let db: Database.Database
let dbDir: string
let workspaceId: string
let workspaceRoot: string
let wsRootDir: string
let keystore: InMemoryKeystore

function makeCtx(role: RoleType, iteration_number = 1): ToolContext {
  return {
    workspace_id: workspaceId,
    workspace_root: workspaceRoot,
    iteration_id: randomUUID(),
    role,
    abort_signal: new AbortController().signal,
    emit_event: () => {},
    db,
    keystore,
    read_files_in_iteration: new Set<string>(),
    iteration_number,
  }
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-tools-mem-db-'))
  wsRootDir = mkdtempSync(join(tmpdir(), 'polycoder-tools-mem-ws-'))
  workspaceRoot = wsRootDir
  db = openDatabase(join(dbDir, 'test.db'))
  keystore = new InMemoryKeystore()
  const ws = createWorkspace(db, { name: 'A', workspace_root: workspaceRoot })
  workspaceId = ws.id
})

afterEach(() => {
  db.close()
  rmSync(dbDir, { recursive: true, force: true })
  rmSync(wsRootDir, { recursive: true, force: true })
})

// ─── read_project_memory ────────────────────────────────────────────

describe('readProjectMemoryTool', () => {
  it('returns full memory by default', async () => {
    const out = await readProjectMemoryTool.call({ section: 'all' }, makeCtx('coder'))
    expect(out.section).toBe('all')
    expect(out.workspace_id).toBe(workspaceId)
  })

  it('returns specific section when requested', async () => {
    const out = await readProjectMemoryTool.call(
      { section: 'decisions' },
      makeCtx('long_term_critic'),
    )
    expect(out.section).toBe('decisions')
    expect(Array.isArray(out.memory)).toBe(true)
  })
})

// ─── update_project_memory ──────────────────────────────────────────

describe('updateProjectMemoryTool', () => {
  it('adds decisions and conventions in one call', async () => {
    const ctx = makeCtx('architect', 3)
    const out = await updateProjectMemoryTool.call(
      {
        add_decisions: [{ decision: 'use SQLite', rationale: 'simplicity' }],
        add_conventions: [{ convention: 'PascalCase', scope: 'global' }],
      },
      ctx,
    )
    expect(out).toMatchObject({
      decisions_added: 1,
      conventions_added: 1,
    })

    // Verify they were stored.
    const read = await readProjectMemoryTool.call({ section: 'decisions' }, makeCtx('architect'))
    expect(Array.isArray(read.memory) && read.memory.length).toBe(1)
  })

  it('iteration_number from ctx is used as default', async () => {
    const ctx = makeCtx('architect', 7)
    await updateProjectMemoryTool.call(
      {
        add_decisions: [{ decision: 'x', rationale: 'y' }],
      },
      ctx,
    )
    const read = await readProjectMemoryTool.call(
      { section: 'decisions' },
      makeCtx('architect'),
    )
    const decisions = read.memory as Array<{ added_in_iteration: number }>
    expect(decisions[0]?.added_in_iteration).toBe(7)
  })
})

// ─── read_history ───────────────────────────────────────────────────

describe('readHistoryTool', () => {
  it('returns empty list when no iterations', async () => {
    const out = await readHistoryTool.call(
      { last_n: 10, include_full_envelopes: false },
      makeCtx('long_term_critic'),
    )
    expect(out.iterations).toHaveLength(0)
  })

  it('returns summarized recent iterations', async () => {
    const it = startIteration(db, { workspace_id: workspaceId, user_prompt: 'p1' })
    finishIteration(db, {
      iteration_id: it.id,
      status: 'completed',
      traffic_light: 'green',
      total_cost_usd: 0.01,
      files_changed: ['src/a.ts'],
      role_outputs: {
        translator: {
          role: 'translator',
          iteration: 1,
          model: 'm',
          status: 'ok',
          summary: 'todo',
          payload: { intent_summary: 'a todo app' },
        },
        coder: {
          role: 'coder',
          iteration: 1,
          model: 'm',
          status: 'ok',
          summary: 'wrote it',
          payload: {},
        },
        test_runner: {
          role: 'test_runner',
          iteration: 1,
          model: 'm',
          status: 'passed',
          summary: 'tests passed',
          payload: {},
        },
      },
      conflicts: [],
    })

    const out = await readHistoryTool.call(
      { last_n: 10, include_full_envelopes: false },
      makeCtx('long_term_critic'),
    )
    expect(out.iterations).toHaveLength(1)
    expect(out.iterations[0]?.intent_summary).toBe('a todo app')
    expect(out.iterations[0]?.traffic_light).toBe('green')
    expect(out.iterations[0]?.coder_status).toBe('ok')
    expect(out.iterations[0]?.test_runner_status).toBe('passed')
    expect(out.iterations[0]?.files_changed).toEqual(['src/a.ts'])
  })

  it('include_full_envelopes returns parsed envelope tree', async () => {
    const it = startIteration(db, { workspace_id: workspaceId, user_prompt: 'p1' })
    finishIteration(db, {
      iteration_id: it.id,
      status: 'completed',
      traffic_light: 'green',
      total_cost_usd: 0,
      files_changed: [],
      role_outputs: {
        translator: {
          role: 'translator',
          iteration: 1,
          model: 'm',
          status: 'ok',
          summary: 's',
          payload: { intent_summary: 'x' },
        },
      },
      conflicts: [],
    })

    const out = await readHistoryTool.call(
      { last_n: 10, include_full_envelopes: true },
      makeCtx('long_term_critic'),
    )
    const first = out.iterations[0] as { full_envelopes?: unknown } | undefined
    expect(first?.full_envelopes).toBeDefined()
  })
})

// ─── read_design_tokens ─────────────────────────────────────────────

describe('readDesignTokensTool', () => {
  it('returns tokens with established_in_iteration null on fresh workspace', async () => {
    const out = await readDesignTokensTool.call({}, makeCtx('designer'))
    expect(out.established_in_iteration).toBeNull()
    expect(out.spacing.unit).toBe('4px')
  })

  it('returns updated tokens after architect sets them', async () => {
    await updateProjectMemoryTool.call(
      {
        set_design_tokens: {
          colors: { primary: '#2563eb' },
          typography: { font_family: 'system-ui', scale: ['14px', '16px'] },
          spacing: { unit: '4px', scale: [4, 8, 16] },
          established_in_iteration: 1,
        },
      },
      makeCtx('architect'),
    )
    const out = await readDesignTokensTool.call({}, makeCtx('designer'))
    expect(out.colors.primary).toBe('#2563eb')
    expect(out.established_in_iteration).toBe(1)
  })
})
