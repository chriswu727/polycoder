import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import { openDatabase } from '../../data/connection.js'
import { InMemoryKeystore } from '../../electron/secrets/keystore.js'
import { createWorkspace } from '../../data/workspace.js'
import { runQuickEdit } from './runQuickEdit.js'
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamEvent,
  TestConnectionResult,
  ModelInfo,
} from '@providers/ModelProvider.js'
import type { Workspace } from '@core/types/workspace.js'

let workspaceRoot: string
let dbDir: string
let db: Database.Database
let keystore: InMemoryKeystore
let workspace: Workspace

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'polycoder-qe-')))
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-qe-db-'))
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'export const greet = () => "hi"\n')
  db = openDatabase(join(dbDir, 'test.db'))
  keystore = new InMemoryKeystore()
  workspace = createWorkspace(db, {
    name: 'demo',
    workspace_root: workspaceRoot,
    ui_lang: 'en',
    preset: 'custom',
  })
})

afterEach(() => {
  db.close()
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

function makeProvider(scripted: ChatResponse[]): ModelProvider {
  let i = 0
  return {
    id: 'deepseek',
    base_url: 'https://example.com',
    listModels(): Promise<ModelInfo[]> {
      return Promise.resolve([])
    },
    chat(_req: ChatRequest): Promise<ChatResponse> {
      const r = scripted[i++]
      if (!r) throw new Error('Provider mock exhausted')
      return Promise.resolve(r)
    },
    stream(): AsyncIterable<StreamEvent> {
      throw new Error('not used')
    },
    testConnection(): Promise<TestConnectionResult> {
      return Promise.resolve({ ok: true, available_models: [] })
    },
  }
}

function textOnly(text: string): ChatResponse {
  return {
    id: randomUUID(),
    content: text,
    tool_calls: [],
    finish_reason: 'stop',
    usage: {
      input_tokens: 12,
      output_tokens: 6,
      cached_input_tokens: 0,
      total_tokens: 18,
      estimated_cost_usd: 0.0002,
    },
    raw_response: undefined,
  }
}

function toolCall(name: string, args: Record<string, unknown>): ChatResponse {
  return {
    id: randomUUID(),
    content: '',
    tool_calls: [
      { id: 'tc-' + randomUUID().slice(0, 8), name, arguments: args },
    ],
    finish_reason: 'tool_use',
    usage: {
      input_tokens: 8,
      output_tokens: 4,
      cached_input_tokens: 0,
      total_tokens: 12,
      estimated_cost_usd: 0.00008,
    },
    raw_response: undefined,
  }
}

describe('runQuickEdit', () => {
  it('completes a no-op instruction with just a summary', async () => {
    const provider = makeProvider([
      textOnly('Looked at the codebase. No changes needed.'),
    ])
    const result = await runQuickEdit({
      db,
      keystore,
      workspace,
      instruction: 'just describe the project',
      provider,
      model: 'deepseek-chat',
    })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.summary).toMatch(/no changes/i)
    expect(result.files_changed).toEqual([])
    expect(result.iteration_number).toBe(1)
    expect(result.total_cost_usd).toBeGreaterThan(0)
  })

  it('tracks files written by the model and persists an iteration row', async () => {
    const provider = makeProvider([
      toolCall('write_file', {
        path: 'src/added.ts',
        content: 'export const x = 1\n',
      }),
      textOnly('Created src/added.ts with a constant.'),
    ])
    const result = await runQuickEdit({
      db,
      keystore,
      workspace,
      instruction: 'add a file exporting x',
      provider,
      model: 'deepseek-chat',
    })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.files_changed).toEqual(['src/added.ts'])
    expect(result.tool_calls_made).toBe(1)
    // File actually exists on disk.
    const written = readFileSync(join(workspaceRoot, 'src', 'added.ts'), 'utf8')
    expect(written).toContain('export const x = 1')

    // Persisted iteration row records role_outputs with ONLY a coder
    // entry — that's the signature Quick Edit uses for UI detection.
    const row = db
      .prepare('SELECT role_outputs_json, status, traffic_light FROM iterations WHERE id = ?')
      .get(result.iteration_id) as Record<string, unknown>
    expect(row.status).toBe('completed')
    expect(row.traffic_light).toBe('green')
    const outputs = JSON.parse(row.role_outputs_json as string) as Record<string, unknown>
    expect(Object.keys(outputs)).toEqual(['coder'])
  })

  it('records cost via cost_records table', async () => {
    const provider = makeProvider([textOnly('did nothing')])
    const result = await runQuickEdit({
      db,
      keystore,
      workspace,
      instruction: 'no-op',
      provider,
      model: 'deepseek-chat',
    })
    expect(result.status).toBe('completed')
    const costs = db
      .prepare('SELECT role, estimated_cost_usd FROM cost_records WHERE iteration_id = ?')
      .all(result.iteration_id) as Array<{ role: string; estimated_cost_usd: number }>
    expect(costs).toHaveLength(1)
    expect(costs[0]?.role).toBe('coder')
    expect(costs[0]?.estimated_cost_usd).toBeGreaterThan(0)
  })
})
