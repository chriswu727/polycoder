import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import { openDatabase } from '../../../data/connection.js'
import { createWorkspace, getHydratedWorkspace } from '../../../data/workspace.js'
import { totalsByIteration } from '../../../data/costRecords.js'
import { listIterations } from '../../../data/iterations.js'
import { InMemoryKeystore } from '../../../electron/secrets/keystore.js'
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamEvent,
  TestConnectionResult,
  ModelInfo,
} from '@providers/ModelProvider.js'

import { runCoderOnly } from './coderOnly.js'

// ─── Setup ──────────────────────────────────────────────────────────

let workspaceRoot: string
let db: Database.Database
let dbDir: string
let keystore: InMemoryKeystore

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'polycoder-co-')))
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-co-db-'))
  db = openDatabase(join(dbDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

// ─── Mock provider ──────────────────────────────────────────────────

function makeMockProvider(content: string): ModelProvider {
  return {
    id: 'deepseek',
    base_url: 'https://example.com',
    listModels(): Promise<ModelInfo[]> {
      return Promise.resolve([])
    },
    chat(_req: ChatRequest): Promise<ChatResponse> {
      return Promise.resolve({
        id: randomUUID(),
        content,
        tool_calls: [],
        finish_reason: 'stop',
        usage: {
          input_tokens: 200,
          output_tokens: 100,
          cached_input_tokens: 0,
          total_tokens: 300,
          estimated_cost_usd: 0.0042,
        },
        raw_response: undefined,
      })
    },
    stream(): AsyncIterable<StreamEvent> {
      throw new Error('stream not used')
    },
    testConnection(): Promise<TestConnectionResult> {
      return Promise.resolve({ ok: true, available_models: [] })
    },
  }
}

const VALID_CODER_PAYLOAD = {
  files_changed: [
    {
      path: 'src/index.html',
      action: 'create',
      reason: 'iter1 prompt',
      content_or_diff: '<html>hi</html>',
    },
  ],
  files_skipped: [],
  uncertainties: [],
  follow_up_needed: [],
}

function validCoderEnvelope(): string {
  return `<role-output role="coder" iteration="1" model="m">
  <status>ok</status>
  <summary>created index.html</summary>
  <payload>${JSON.stringify(VALID_CODER_PAYLOAD)}</payload>
</role-output>`
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('runCoderOnly', () => {
  it('completes when Coder produces a valid envelope', async () => {
    const ws = createWorkspace(db, { name: 'co-test', workspace_root: workspaceRoot })
    const hydrated = getHydratedWorkspace(db, ws.id)!
    const provider = makeMockProvider(validCoderEnvelope())

    const result = await runCoderOnly({
      db,
      keystore,
      workspace: hydrated,
      user_prompt: 'build a hello-world page',
      providerFactory: () => Promise.resolve({ provider, model: 'deepseek-chat' }),
    })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.traffic_light).toBe('green')
    expect(result.role_outputs.coder).toBeDefined()
    expect(result.files_changed).toEqual(['src/index.html'])
    expect(result.total_cost_usd).toBeGreaterThan(0)
    expect(result.conflicts).toEqual([])
  })

  it('persists exactly one cost record (Coder only)', async () => {
    const ws = createWorkspace(db, { name: 'co-test', workspace_root: workspaceRoot })
    const hydrated = getHydratedWorkspace(db, ws.id)!
    const provider = makeMockProvider(validCoderEnvelope())

    const result = await runCoderOnly({
      db,
      keystore,
      workspace: hydrated,
      user_prompt: 'p',
      providerFactory: () => Promise.resolve({ provider, model: 'm' }),
    })
    expect(result.status).toBe('completed')

    const totals = totalsByIteration(db, result.iteration_id)
    expect(totals.call_count).toBe(1)
    expect(totals.total_cost_usd).toBeCloseTo(0.0042, 4)
  })

  it('persists an iteration row marked completed/green', async () => {
    const ws = createWorkspace(db, { name: 'co-test', workspace_root: workspaceRoot })
    const hydrated = getHydratedWorkspace(db, ws.id)!
    const provider = makeMockProvider(validCoderEnvelope())

    await runCoderOnly({
      db,
      keystore,
      workspace: hydrated,
      user_prompt: 'p',
      providerFactory: () => Promise.resolve({ provider, model: 'm' }),
    })

    const its = listIterations(db, ws.id, { limit: 10 })
    expect(its).toHaveLength(1)
    expect(its[0]!.status).toBe('completed')
    expect(its[0]!.traffic_light).toBe('green')
  })

  it('returns failed when Coder produces malformed XML', async () => {
    const ws = createWorkspace(db, { name: 'co-test', workspace_root: workspaceRoot })
    const hydrated = getHydratedWorkspace(db, ws.id)!
    const provider = makeMockProvider('not xml at all')

    const result = await runCoderOnly({
      db,
      keystore,
      workspace: hydrated,
      user_prompt: 'p',
      providerFactory: () => Promise.resolve({ provider, model: 'm' }),
    })

    expect(result.status).toBe('failed')
    if (result.status !== 'failed') return
    expect(result.stopped_at_role).toBe('coder')
    expect(result.error_code).toBeTruthy()
  })

  it('does not invoke any role other than Coder', async () => {
    const ws = createWorkspace(db, { name: 'co-test', workspace_root: workspaceRoot })
    const hydrated = getHydratedWorkspace(db, ws.id)!

    const calls: string[] = []
    const provider: ModelProvider = {
      id: 'deepseek',
      base_url: 'https://example.com',
      listModels(): Promise<ModelInfo[]> {
        return Promise.resolve([])
      },
      chat(req: ChatRequest): Promise<ChatResponse> {
        const sys = (req.messages.find((m) => m.role === 'system')?.content ?? '') as string
        const role = /Role:\s*Coder/.test(sys) ? 'coder' : 'unknown'
        calls.push(role)
        return Promise.resolve({
          id: randomUUID(),
          content: validCoderEnvelope(),
          tool_calls: [],
          finish_reason: 'stop',
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cached_input_tokens: 0,
            total_tokens: 2,
            estimated_cost_usd: 0.0001,
          },
          raw_response: undefined,
        })
      },
      stream(): AsyncIterable<StreamEvent> {
        throw new Error('stream not used')
      },
      testConnection(): Promise<TestConnectionResult> {
        return Promise.resolve({ ok: true, available_models: [] })
      },
    }

    await runCoderOnly({
      db,
      keystore,
      workspace: hydrated,
      user_prompt: 'p',
      providerFactory: () => Promise.resolve({ provider, model: 'm' }),
    })

    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c === 'coder')).toBe(true)
  })
})
