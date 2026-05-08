import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../data/connection.js'
import { InMemoryKeystore } from '../../electron/secrets/keystore.js'
import { runWithTools, ToolLoopBudgetExceeded } from './runWithTools.js'
import { readFileTool } from '@tools/readFile.js'
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamEvent,
  TestConnectionResult,
  ModelInfo,
} from '@providers/ModelProvider.js'
import type { ToolContext } from '@tools/ToolDef.js'

// ─── Test scaffolding ───────────────────────────────────────────────

let workspaceRoot: string
let db: Database.Database
let dbDir: string
let keystore: InMemoryKeystore

function makeCtx(): ToolContext {
  return {
    workspace_id: randomUUID(),
    workspace_root: workspaceRoot,
    iteration_id: randomUUID(),
    role: 'coder',
    abort_signal: new AbortController().signal,
    emit_event: () => {},
    db,
    keystore,
    read_files_in_iteration: new Set<string>(),
    iteration_number: 1,
  }
}

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'polycoder-rwt-')))
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-rwt-db-'))
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'src', 'index.ts'), 'hello\n')
  db = openDatabase(join(dbDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

// ─── Mock provider ──────────────────────────────────────────────────

function makeProvider(scriptedResponses: ChatResponse[]): ModelProvider {
  let i = 0
  return {
    id: 'deepseek',
    base_url: 'https://example.com',
    listModels(): Promise<ModelInfo[]> {
      return Promise.resolve([])
    },
    chat(_request: ChatRequest): Promise<ChatResponse> {
      const r = scriptedResponses[i++]
      if (!r) throw new Error('Provider mock exhausted')
      return Promise.resolve(r)
    },
    stream(): AsyncIterable<StreamEvent> {
      throw new Error('not used in these tests')
    },
    testConnection(): Promise<TestConnectionResult> {
      return Promise.resolve({ ok: true, available_models: [] })
    },
  }
}

function textOnlyResponse(text: string): ChatResponse {
  return {
    id: randomUUID(),
    content: text,
    tool_calls: [],
    finish_reason: 'stop',
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cached_input_tokens: 0,
      total_tokens: 15,
      estimated_cost_usd: 0.0001,
    },
    raw_response: undefined,
  }
}

function toolCallResponse(args: {
  name: string
  arguments: Record<string, unknown>
}): ChatResponse {
  return {
    id: randomUUID(),
    content: '',
    tool_calls: [
      {
        id: 'tc-' + randomUUID().slice(0, 8),
        name: args.name,
        arguments: args.arguments,
      },
    ],
    finish_reason: 'tool_use',
    usage: {
      input_tokens: 5,
      output_tokens: 5,
      cached_input_tokens: 0,
      total_tokens: 10,
      estimated_cost_usd: 0.00005,
    },
    raw_response: undefined,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('runWithTools — terminal text response (no tool calls)', () => {
  it('returns the text directly', async () => {
    const provider = makeProvider([textOnlyResponse('the model output')])
    const result = await runWithTools({
      provider,
      model: 'deepseek-chat',
      systemPrompt: 'you are an agent',
      initialUserMessage: 'go',
      tools: [],
      ctx: makeCtx(),
    })
    expect(result.finalText).toBe('the model output')
    expect(result.toolCallsMade).toBe(0)
    expect(result.totalUsage.input_tokens).toBe(10)
  })
})

describe('runWithTools — tool-use loop', () => {
  it('executes a tool call and feeds the result back, then returns final text', async () => {
    const provider = makeProvider([
      toolCallResponse({ name: 'read_file', arguments: { path: 'src/index.ts' } }),
      textOnlyResponse('done after reading'),
    ])
    const result = await runWithTools({
      provider,
      model: 'deepseek-chat',
      systemPrompt: 'you are an agent',
      initialUserMessage: 'read the file',
      tools: [readFileTool as never],
      ctx: makeCtx(),
    })
    expect(result.finalText).toBe('done after reading')
    expect(result.toolCallsMade).toBe(1)
    expect(result.totalUsage.input_tokens).toBe(15) // 5 + 10
  })

  it('returns a permission_denied error to the model when tool not in allowlist', async () => {
    const provider = makeProvider([
      toolCallResponse({ name: 'write_file', arguments: { path: 'x', content: '' } }),
      textOnlyResponse('observed denial; giving up'),
    ])
    const result = await runWithTools({
      provider,
      model: 'deepseek-chat',
      systemPrompt: '',
      initialUserMessage: 'go',
      tools: [readFileTool as never], // only read_file in allowlist
      ctx: makeCtx(),
    })
    // The tool result was an error, but the loop continues until the
    // model responds with text. Final text reflects the model's turn
    // after seeing the denial.
    expect(result.finalText).toBe('observed denial; giving up')
    expect(result.toolCallsMade).toBe(1)
  })

  it('returns invalid_input error when tool args fail Zod validation', async () => {
    const provider = makeProvider([
      // Invalid: read_file requires `path` (string), not `pat`.
      toolCallResponse({ name: 'read_file', arguments: { pat: 5 } }),
      textOnlyResponse('handled'),
    ])
    const result = await runWithTools({
      provider,
      model: 'deepseek-chat',
      systemPrompt: '',
      initialUserMessage: 'go',
      tools: [readFileTool as never],
      ctx: makeCtx(),
    })
    expect(result.finalText).toBe('handled')
    expect(result.toolCallsMade).toBe(1)
  })

  it('throws ToolLoopBudgetExceeded after maxToolCalls', async () => {
    // Provider keeps requesting tool calls; we cap at 2.
    const provider = makeProvider([
      toolCallResponse({ name: 'read_file', arguments: { path: 'src/index.ts' } }),
      toolCallResponse({ name: 'read_file', arguments: { path: 'src/index.ts' } }),
      toolCallResponse({ name: 'read_file', arguments: { path: 'src/index.ts' } }),
    ])
    await expect(
      runWithTools({
        provider,
        model: 'deepseek-chat',
        systemPrompt: '',
        initialUserMessage: 'loop forever',
        tools: [readFileTool as never],
        ctx: makeCtx(),
        maxToolCalls: 2,
      }),
    ).rejects.toBeInstanceOf(ToolLoopBudgetExceeded)
  })
})
