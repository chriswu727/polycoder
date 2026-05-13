import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
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
import { revertIteration } from './revertIteration.js'
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
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'polycoder-rev-')))
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-rev-db-'))
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'src', 'auth.ts'), 'export const x = 1\n')
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
      if (!r) throw new Error('exhausted')
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
      input_tokens: 8,
      output_tokens: 4,
      cached_input_tokens: 0,
      total_tokens: 12,
      estimated_cost_usd: 0.0001,
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
      input_tokens: 5,
      output_tokens: 3,
      cached_input_tokens: 0,
      total_tokens: 8,
      estimated_cost_usd: 0.00005,
    },
    raw_response: undefined,
  }
}

describe('revertIteration', () => {
  it('restores pre-edit content for an edited file', async () => {
    const provider = makeProvider([
      toolCall('edit_file', {
        path: 'src/auth.ts',
        old_string: 'export const x = 1',
        new_string: 'export const x = 99',
      }),
      textOnly('Changed x to 99.'),
    ])
    const r = await runQuickEdit({
      db,
      keystore,
      workspace,
      instruction: 'change x to 99 in @src/auth.ts',
      provider,
      model: 'deepseek-chat',
    })
    if (r.status !== 'completed') throw new Error('expected completed')

    // After the edit, file should contain 99.
    let onDisk = readFileSync(join(workspaceRoot, 'src', 'auth.ts'), 'utf8')
    expect(onDisk).toContain('99')

    const rev = revertIteration(db, r.iteration_id)
    expect(rev.ok).toBe(true)
    expect(rev.restored).toEqual(['src/auth.ts'])
    expect(rev.deleted).toEqual([])

    // File restored to 1.
    onDisk = readFileSync(join(workspaceRoot, 'src', 'auth.ts'), 'utf8')
    expect(onDisk).toContain('export const x = 1')
    expect(onDisk).not.toContain('99')
  })

  it('deletes newly-created files on revert', async () => {
    const provider = makeProvider([
      toolCall('write_file', {
        path: 'src/added.ts',
        content: 'export const y = 2\n',
      }),
      textOnly('Added a file.'),
    ])
    const r = await runQuickEdit({
      db,
      keystore,
      workspace,
      instruction: 'add a new file',
      provider,
      model: 'deepseek-chat',
    })
    if (r.status !== 'completed') throw new Error('expected completed')
    expect(existsSync(join(workspaceRoot, 'src', 'added.ts'))).toBe(true)

    const rev = revertIteration(db, r.iteration_id)
    expect(rev.ok).toBe(true)
    expect(rev.deleted).toEqual(['src/added.ts'])
    expect(existsSync(join(workspaceRoot, 'src', 'added.ts'))).toBe(false)
  })

  it('errors when no snapshots exist (pre-revert iteration)', () => {
    // Manually create an iteration row with no snapshots.
    const fakeId = randomUUID()
    db.prepare(
      `INSERT INTO iterations
        (id, workspace_id, iteration_number, user_prompt, status,
         traffic_light, started_at, files_changed, role_outputs_json, conflicts_json)
       VALUES (?, ?, 99, 'x', 'completed', 'green', ?, '[]', '{}', '[]')`,
    ).run(fakeId, workspace.id, Date.now())
    const rev = revertIteration(db, fakeId)
    expect(rev.ok).toBe(false)
    expect(rev.error).toMatch(/no file snapshots/i)
  })
})
