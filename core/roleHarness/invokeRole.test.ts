import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../data/connection.js'
import { InMemoryKeystore } from '../../electron/secrets/keystore.js'
import { invokeRole } from './invokeRole.js'
import { ProviderError } from '@providers/errors.js'
import type {
  ChatRequest,
  ChatResponse,
  ModelProvider,
  StreamEvent,
  TestConnectionResult,
  ModelInfo,
} from '@providers/ModelProvider.js'
import type { ToolContext } from '@tools/ToolDef.js'
import { emptyProjectMemory } from '@core/types/projectMemory.js'

let workspaceRoot: string
let db: Database.Database
let dbDir: string
let keystore: InMemoryKeystore

function makeCtx(): ToolContext {
  return {
    workspace_id: randomUUID(),
    workspace_root: workspaceRoot,
    iteration_id: randomUUID(),
    role: 'translator',
    abort_signal: new AbortController().signal,
    emit_event: () => {},
    db,
    keystore,
    read_files_in_iteration: new Set<string>(),
    iteration_number: 1,
  }
}

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'polycoder-ir-')))
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-ir-db-'))
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  db = openDatabase(join(dbDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

// ─── Mock provider ──────────────────────────────────────────────────

function makeScriptedProvider(responses: Array<ChatResponse | Error>): ModelProvider {
  let i = 0
  return {
    id: 'deepseek',
    base_url: 'https://example.com',
    listModels(): Promise<ModelInfo[]> {
      return Promise.resolve([])
    },
    chat(_req: ChatRequest): Promise<ChatResponse> {
      const r = responses[i++]
      if (!r) throw new Error('Provider mock exhausted')
      if (r instanceof Error) throw r
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

function envelope(role: string, payload: Record<string, unknown>): ChatResponse {
  const xml = `<role-output role="${role}" iteration="1" model="m">
  <status>ok</status>
  <summary>x</summary>
  <payload>${JSON.stringify(payload)}</payload>
</role-output>`
  return {
    id: randomUUID(),
    content: xml,
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

const promptInputs = {
  workspace_name: 'TestWS',
  iteration_number: 1,
  project_memory: null,
  total_iterations: 0,
}

// ─── Happy path ─────────────────────────────────────────────────────

describe('invokeRole — happy path', () => {
  it('parses a valid Translator envelope and returns success', async () => {
    const provider = makeScriptedProvider([
      envelope('translator', {
        intent_summary: 'todo app',
        must_have: ['add'],
      }),
    ])
    const result = await invokeRole({
      role: 'translator',
      provider,
      model: 'deepseek-chat',
      ctx: makeCtx(),
      promptInputs,
      envelopeInputs: { project_memory: null, task: 'build a todo' },
    })
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.envelope.role).toBe('translator')
      expect(result.envelope.model).toBe('deepseek-chat') // overridden
      expect(result.attempts).toBe(1)
    }
  })
})

// ─── Re-prompt: envelope parse failure ──────────────────────────────

describe('invokeRole — envelope parse re-prompt', () => {
  it('retries once after invalid envelope, succeeds on attempt 2', async () => {
    const provider = makeScriptedProvider([
      // Attempt 1: malformed (no envelope at all)
      {
        id: 'r1',
        content: 'plain prose, no envelope',
        tool_calls: [],
        finish_reason: 'stop',
        usage: { input_tokens: 5, output_tokens: 5, cached_input_tokens: 0, total_tokens: 10, estimated_cost_usd: 0.00005 },
        raw_response: undefined,
      } satisfies ChatResponse,
      // Attempt 2: valid
      envelope('translator', { intent_summary: 'fixed', must_have: [] }),
    ])
    const result = await invokeRole({
      role: 'translator',
      provider,
      model: 'deepseek-chat',
      ctx: makeCtx(),
      promptInputs,
      envelopeInputs: { project_memory: null, task: 't' },
    })
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.attempts).toBe(2)
    }
  })

  it('returns envelope_parse_exhausted after MAX_ROLE_ATTEMPTS', async () => {
    const bad: ChatResponse = {
      id: 'x',
      content: 'no envelope here',
      tool_calls: [],
      finish_reason: 'stop',
      usage: { input_tokens: 5, output_tokens: 5, cached_input_tokens: 0, total_tokens: 10, estimated_cost_usd: 0 },
      raw_response: undefined,
    }
    const provider = makeScriptedProvider([bad, bad, bad])
    const result = await invokeRole({
      role: 'translator',
      provider,
      model: 'deepseek-chat',
      ctx: makeCtx(),
      promptInputs,
      envelopeInputs: { project_memory: null, task: 't' },
    })
    expect(result.status).toBe('failure')
    if (result.status === 'failure') {
      expect(result.reason).toBe('envelope_parse_exhausted')
      expect(result.attempts).toBe(3)
    }
  })
})

// ─── Re-prompt: payload schema violation ────────────────────────────

describe('invokeRole — payload schema re-prompt', () => {
  it('retries when intent_summary missing, succeeds on retry', async () => {
    const provider = makeScriptedProvider([
      // Attempt 1: missing required intent_summary
      envelope('translator', { must_have: ['x'] }),
      // Attempt 2: corrected
      envelope('translator', { intent_summary: 'fixed', must_have: ['x'] }),
    ])
    const result = await invokeRole({
      role: 'translator',
      provider,
      model: 'm',
      ctx: makeCtx(),
      promptInputs,
      envelopeInputs: { project_memory: null, task: 't' },
    })
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.attempts).toBe(2)
    }
  })
})

// ─── Synthesis discipline (Architect-only) ──────────────────────────

describe('invokeRole — synthesis discipline (Architect)', () => {
  it('retries when Architect output contains a forbidden phrase', async () => {
    const provider = makeScriptedProvider([
      // Architect's payload contains "based on the prior findings"
      envelope('architect', {
        guidance_for_coder: {
          patterns_to_follow: [
            {
              pattern: 'Based on the prior findings, refactor X',
              why: 'cleanliness',
              files_to_touch: [],
            },
          ],
          patterns_to_avoid: [],
          naming_conventions: [],
          files_likely_affected: [],
        },
        memory_updates: null,
        conflicts: [],
        tech_debt_added: [],
      }),
      // Retry returns clean text
      envelope('architect', {
        guidance_for_coder: {
          patterns_to_follow: [
            {
              pattern: 'Refactor src/x.ts to use Zustand store at src/store/x.ts',
              why: 'clearness',
              files_to_touch: ['src/x.ts', 'src/store/x.ts'],
            },
          ],
          patterns_to_avoid: [],
          naming_conventions: [],
          files_likely_affected: [],
        },
        memory_updates: null,
        conflicts: [],
        tech_debt_added: [],
      }),
    ])
    const result = await invokeRole({
      role: 'architect',
      provider,
      model: 'm',
      ctx: { ...makeCtx(), role: 'architect' },
      promptInputs,
      envelopeInputs: {
        project_memory: emptyProjectMemory(randomUUID()),
        task: 't',
      },
    })
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.attempts).toBe(2)
      expect(result.synthesisDisciplineWarning).toBeUndefined()
    }
  })

  it('emits with synthesisDisciplineWarning if all 3 attempts violate', async () => {
    const violatingEnvelope = envelope('architect', {
      guidance_for_coder: {
        patterns_to_follow: [
          { pattern: 'Per the Translator', why: 'x', files_to_touch: [] },
        ],
        patterns_to_avoid: [],
        naming_conventions: [],
        files_likely_affected: [],
      },
      memory_updates: null,
      conflicts: [],
      tech_debt_added: [],
    })
    const provider = makeScriptedProvider([
      violatingEnvelope,
      violatingEnvelope,
      violatingEnvelope,
    ])
    const result = await invokeRole({
      role: 'architect',
      provider,
      model: 'm',
      ctx: { ...makeCtx(), role: 'architect' },
      promptInputs,
      envelopeInputs: {
        project_memory: emptyProjectMemory(randomUUID()),
        task: 't',
      },
    })
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.synthesisDisciplineWarning).toBeDefined()
    }
  })
})

// ─── Provider error retry ───────────────────────────────────────────

describe('invokeRole — provider error retry', () => {
  it('retries on retryable ProviderError, succeeds on attempt 2', async () => {
    const provider = makeScriptedProvider([
      new ProviderError('rate_limited', 'deepseek', 'm', '429', true, 1),
      envelope('translator', { intent_summary: 'recovered', must_have: [] }),
    ])
    const result = await invokeRole({
      role: 'translator',
      provider,
      model: 'm',
      ctx: makeCtx(),
      promptInputs,
      envelopeInputs: { project_memory: null, task: 't' },
    })
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.attempts).toBe(2)
    }
  })

  it('fails immediately on non-retryable error', async () => {
    const provider = makeScriptedProvider([
      new ProviderError('auth_failed', 'deepseek', 'm', 'bad key', false),
    ])
    const result = await invokeRole({
      role: 'translator',
      provider,
      model: 'm',
      ctx: makeCtx(),
      promptInputs,
      envelopeInputs: { project_memory: null, task: 't' },
    })
    expect(result.status).toBe('failure')
    if (result.status === 'failure') {
      expect(result.reason).toBe('provider_error')
      expect(result.attempts).toBe(1)
      expect(result.detail).toContain('auth_failed')
    }
  })
})
