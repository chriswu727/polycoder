// End-to-end integration test for runIteration. Mocked providers
// return canned envelopes for each of the 8 role calls; the
// orchestrator wires them through the full pipeline including
// detectConflicts + applyMemoryUpdates + persistence.

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
import { createWorkspace } from '../../data/workspace.js'
import { getProjectMemory } from '../../data/projectMemory.js'
import { listIterations, getIteration } from '../../data/iterations.js'
import { totalsByIteration } from '../../data/costRecords.js'
import { InMemoryKeystore } from '../../electron/secrets/keystore.js'
import { runIteration } from './runIteration.js'
import { PipelineEventBus } from './events.js'
import type {
  ChatRequest,
  ChatResponse,
  ModelInfo,
  ModelProvider,
  StreamEvent,
  TestConnectionResult,
} from '@providers/ModelProvider.js'
import type { RoleType } from '@core/types/role.js'

// ─── Test scaffolding ───────────────────────────────────────────────

let workspaceRoot: string
let db: Database.Database
let dbDir: string
let keystore: InMemoryKeystore

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'polycoder-rit-')))
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-rit-db-'))
  db = openDatabase(join(dbDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

// ─── Mock provider factory ──────────────────────────────────────────

function makeMockProvider(envelopeForRole: (role: RoleType) => string): ModelProvider {
  return {
    id: 'deepseek',
    base_url: 'https://example.com',
    listModels(): Promise<ModelInfo[]> {
      return Promise.resolve([])
    },
    chat(req: ChatRequest): Promise<ChatResponse> {
      // Detect role from system prompt content (each role's system
      // prompt mentions its own name in the identity section).
      const sys = (req.messages.find((m) => m.role === 'system')?.content ?? '') as string
      const role = inferRoleFromSystemPrompt(sys)
      const xml = envelopeForRole(role)
      return Promise.resolve({
        id: randomUUID(),
        content: xml,
        tool_calls: [],
        finish_reason: 'stop',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cached_input_tokens: 0,
          total_tokens: 150,
          estimated_cost_usd: 0.001,
        },
        raw_response: undefined,
      })
    },
    async *stream(req: ChatRequest): AsyncIterable<StreamEvent> {
      const sys = (req.messages.find((m) => m.role === 'system')?.content ?? '') as string
      const role = inferRoleFromSystemPrompt(sys)
      const xml = envelopeForRole(role)
      yield { type: 'content_delta', delta: xml }
      yield {
        type: 'message_complete',
        response: {
          id: randomUUID(),
          content: xml,
          tool_calls: [],
          finish_reason: 'stop',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cached_input_tokens: 0,
            total_tokens: 150,
            estimated_cost_usd: 0.001,
          },
          raw_response: undefined,
        },
      }
    },
    testConnection(): Promise<TestConnectionResult> {
      return Promise.resolve({ ok: true, available_models: [] })
    },
  }
}

function inferRoleFromSystemPrompt(sys: string): RoleType {
  // The role markdown files have headings like "Role: Translator".
  if (/Role:\s*Translator/.test(sys)) return 'translator'
  if (/Role:\s*Designer/.test(sys)) return 'designer'
  if (/Role:\s*Architect/.test(sys)) return 'architect'
  if (/Role:\s*Coder/.test(sys)) return 'coder'
  if (/Role:\s*Adversary/.test(sys)) return 'adversary'
  if (/Role:\s*Long-term Critic/.test(sys)) return 'long_term_critic'
  if (/Role:\s*Test Runner/.test(sys)) return 'test_runner'
  if (/Role:\s*Communicator/.test(sys)) return 'communicator'
  throw new Error('cannot infer role from system prompt')
}

function envelope(role: RoleType, payload: Record<string, unknown>): string {
  return `<role-output role="${role}" iteration="1" model="m">
  <status>${defaultStatusForRole(role)}</status>
  <summary>summary</summary>
  <payload>${JSON.stringify(payload)}</payload>
</role-output>`
}

function defaultStatusForRole(role: RoleType): string {
  switch (role) {
    case 'adversary':
      return 'clean'
    case 'test_runner':
      return 'passed'
    case 'long_term_critic':
      return 'healthy'
    case 'communicator':
      return 'green'
    default:
      return 'ok'
  }
}

const HAPPY_PATH_PAYLOADS: Record<RoleType, Record<string, unknown>> = {
  translator: { intent_summary: 'simple todo app', must_have: ['add', 'list'] },
  designer: {
    layout: { primary_view: 'single page', navigation_pattern: 'none' },
    components: [],
    design_tokens: { colors: {} },
    ui_lang: 'zh-CN',
  },
  architect: {
    guidance_for_coder: {
      patterns_to_follow: [
        {
          pattern: 'Use Zustand at src/store/tasks.ts with localStorage persistence',
          why: 'Spec requires single-user, no-backend, persisted-across-refresh',
          files_to_touch: ['src/store/tasks.ts'],
        },
      ],
      patterns_to_avoid: [],
      naming_conventions: ['PascalCase for components'],
      files_likely_affected: ['src/store/tasks.ts'],
    },
    memory_updates: {
      new_decisions: [
        {
          decision: 'Frontend-only architecture, no backend in V1',
          rationale: 'Spec requires single-user, no backend',
          supersedes: null,
        },
      ],
      new_conventions: [],
      components_registered: [],
    },
    conflicts: [],
    tech_debt_added: [],
  },
  coder: {
    files_changed: [
      {
        path: 'src/store/tasks.ts',
        action: 'create',
        reason: 'patterns_to_follow[0]',
        content_or_diff: 'export const useTasks = () => ({})',
      },
    ],
    files_skipped: [],
    uncertainties: [],
    follow_up_needed: [],
  },
  adversary: {
    issues: [],
    checked_categories: ['xss', 'race_conditions'],
    explicit_negative_findings: ['React auto-escapes', 'Sync mutations'],
    confidence: 'high',
    could_not_assess: [],
  },
  long_term_critic: {
    health_metrics: { complexity_trend: 'stable' },
    future_stress_predictions: [],
    tech_debt_inventory: [],
    fragility_flags: [],
    refactor_opportunities: [],
    memory_lessons_to_persist: [],
  },
  test_runner: {
    tests_written: [],
    test_run: {
      command: 'pnpm test',
      exit_code: 0,
      output_summary: '5 pass',
      passed_count: 5,
      failed_count: 0,
      skipped_count: 0,
      duration_ms: 234,
    },
    failures: [],
    coverage_assessment: { coverage_adequacy: 'good' },
    follow_up_for_coder: [],
  },
  communicator: {
    user_facing_text: 'todo app done; no issues',
    traffic_light: 'green',
    traffic_light_reason: 'all checks passed',
    disagreement_cards: [],
    what_changed: ['created src/store/tasks.ts'],
    what_to_do_next: [],
  },
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('runIteration — happy path end-to-end', () => {
  it('completes through all 8 roles, persists outputs + cost rows + memory', async () => {
    const ws = createWorkspace(db, { name: 'TestApp', workspace_root: workspaceRoot })

    const provider = makeMockProvider((role) =>
      envelope(role, HAPPY_PATH_PAYLOADS[role]),
    )

    const events: string[] = []
    const bus = new PipelineEventBus()
    bus.subscribe((e) => events.push(e.type))

    const result = await runIteration({
      db,
      keystore,
      workspace: ws,
      user_prompt: 'build me a todo app',
      providerFactory: () => Promise.resolve({ provider, model: 'deepseek-chat' }),
      eventBus: bus,
    })

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.traffic_light).toBe('green')
    expect(result.role_outputs.translator).toBeDefined()
    expect(result.role_outputs.designer).toBeDefined()
    expect(result.role_outputs.architect).toBeDefined()
    expect(result.role_outputs.coder).toBeDefined()
    expect(result.role_outputs.adversary).toBeDefined()
    expect(result.role_outputs.long_term_critic).toBeDefined()
    expect(result.role_outputs.test_runner).toBeDefined()
    expect(result.role_outputs.communicator).toBeDefined()
    expect(result.files_changed).toContain('src/store/tasks.ts')

    // Iteration row persisted with status: completed.
    const iters = listIterations(db, ws.id)
    expect(iters).toHaveLength(1)
    expect(iters[0]?.status).toBe('completed')
    expect(iters[0]?.traffic_light).toBe('green')

    // Cost records persisted (one per role × 8 roles).
    const costs = totalsByIteration(db, result.iteration_id)
    expect(costs.call_count).toBe(8)
    expect(costs.total_cost_usd).toBeGreaterThan(0)

    // Memory updated with Architect's new decision.
    const memory = getProjectMemory(db, ws.id)!
    expect(memory.decisions).toHaveLength(1)
    expect(memory.decisions[0]?.decision).toBe('Frontend-only architecture, no backend in V1')

    // Events emitted: at least 8 role_started, 8 role_completed, 1 iteration_completed.
    const startedCount = events.filter((e) => e === 'role_started').length
    const completedCount = events.filter((e) => e === 'role_completed').length
    expect(startedCount).toBe(8)
    expect(completedCount).toBe(8)
    expect(events).toContain('iteration_completed')
  }, 30_000)

  it('captures full role envelopes in iterations.role_outputs_json', async () => {
    const ws = createWorkspace(db, { name: 'X', workspace_root: workspaceRoot })
    const provider = makeMockProvider((role) =>
      envelope(role, HAPPY_PATH_PAYLOADS[role]),
    )
    const result = await runIteration({
      db,
      keystore,
      workspace: ws,
      user_prompt: 'x',
      providerFactory: () => Promise.resolve({ provider, model: 'm' }),
    })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return

    const stored = getIteration(db, result.iteration_id)
    expect(stored).not.toBeNull()
    const outputs = JSON.parse(stored!.role_outputs_json) as Record<string, unknown>
    expect(Object.keys(outputs).sort()).toEqual(
      [
        'adversary',
        'architect',
        'coder',
        'communicator',
        'designer',
        'long_term_critic',
        'test_runner',
        'translator',
      ].sort(),
    )
  })
})

describe('runIteration — Architect conflict aborts iteration', () => {
  it('returns aborted when Architect status is conflict_detected', async () => {
    const ws = createWorkspace(db, { name: 'X', workspace_root: workspaceRoot })

    const provider = makeMockProvider((role) => {
      if (role === 'architect') {
        return `<role-output role="architect" iteration="1" model="m">
  <status>conflict_detected</status>
  <summary>conflict</summary>
  <payload>${JSON.stringify({
    guidance_for_coder: null,
    memory_updates: null,
    conflicts: [
      {
        with: 'decisions[0]',
        this_iteration_wants: 'add login',
        memory_says: 'no backend',
        recommendation: 'ask_user',
      },
    ],
    tech_debt_added: [],
  })}</payload>
</role-output>`
      }
      return envelope(role, HAPPY_PATH_PAYLOADS[role])
    })

    const result = await runIteration({
      db,
      keystore,
      workspace: ws,
      user_prompt: 'add login',
      providerFactory: () => Promise.resolve({ provider, model: 'm' }),
    })

    expect(result.status).toBe('aborted')
    if (result.status === 'aborted') {
      expect(result.stopped_at_role).toBe('architect')
      expect(result.reason).toMatch(/conflict/i)
    }

    const iters = listIterations(db, ws.id)
    expect(iters[0]?.status).toBe('aborted')
  })
})

describe('runIteration — failure surfaces structured error', () => {
  it('surfaces translator failure (envelope parse exhausted)', async () => {
    const ws = createWorkspace(db, { name: 'X', workspace_root: workspaceRoot })

    const provider: ModelProvider = {
      id: 'deepseek',
      base_url: 'x',
      listModels(): Promise<ModelInfo[]> {
        return Promise.resolve([])
      },
      chat(): Promise<ChatResponse> {
        return Promise.resolve({
          id: 'x',
          content: 'this is just plain prose, no envelope',
          tool_calls: [],
          finish_reason: 'stop',
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cached_input_tokens: 0,
            total_tokens: 2,
            estimated_cost_usd: 0,
          },
          raw_response: undefined,
        })
      },
      async *stream(): AsyncIterable<StreamEvent> {
        yield { type: 'content_delta', delta: 'this is just plain prose, no envelope' }
        yield {
          type: 'message_complete',
          response: {
            id: 'x',
            content: 'this is just plain prose, no envelope',
            tool_calls: [],
            finish_reason: 'stop',
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              cached_input_tokens: 0,
              total_tokens: 2,
              estimated_cost_usd: 0,
            },
            raw_response: undefined,
          },
        }
      },
      testConnection(): Promise<TestConnectionResult> {
        return Promise.resolve({ ok: true, available_models: [] })
      },
    }

    const result = await runIteration({
      db,
      keystore,
      workspace: ws,
      user_prompt: 'x',
      providerFactory: () => Promise.resolve({ provider, model: 'm' }),
    })
    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.stopped_at_role).toBe('translator')
      expect(result.error_code).toBe('envelope_parse_exhausted')
    }
  })
})
