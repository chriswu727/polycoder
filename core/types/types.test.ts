// Schema validation tests. Verify each schema parses canonical valid
// input and rejects representative invalid inputs.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  RoleTypeSchema,
  RoleOutputEnvelopeSchema,
  ALL_ROLES,
} from './role.js'
import {
  WorkspaceSchema,
  SecretMetaSchema,
  RoleAssignmentSchema,
  ProviderIdSchema,
} from './workspace.js'
import {
  ProjectMemorySchema,
  emptyProjectMemory,
  MemoryUpdateInputSchema,
} from './projectMemory.js'
import { TokenUsageSchema, CostRecordSchema } from './cost.js'
import {
  IterationRecordSchema,
  RoleConflictSchema,
} from './iteration.js'

describe('RoleType', () => {
  it('accepts all 8 role names', () => {
    for (const role of ALL_ROLES) {
      expect(() => RoleTypeSchema.parse(role)).not.toThrow()
    }
  })

  it('rejects unknown role', () => {
    expect(() => RoleTypeSchema.parse('manager')).toThrow()
  })

  it('ALL_ROLES contains exactly 8 entries', () => {
    expect(ALL_ROLES).toHaveLength(8)
  })
})

describe('RoleOutputEnvelope', () => {
  it('parses a minimal valid envelope', () => {
    const env = {
      role: 'translator',
      iteration: 1,
      model: 'deepseek-chat',
      status: 'ok',
      summary: 'short summary',
      payload: { foo: 'bar' },
    }
    const parsed = RoleOutputEnvelopeSchema.parse(env)
    expect(parsed.role).toBe('translator')
    expect(parsed.payload).toEqual({ foo: 'bar' })
  })

  it('rejects negative iteration', () => {
    expect(() =>
      RoleOutputEnvelopeSchema.parse({
        role: 'coder',
        iteration: -1,
        model: 'x',
        status: 'ok',
        summary: 's',
        payload: {},
      }),
    ).toThrow()
  })

  it('rejects empty model id', () => {
    expect(() =>
      RoleOutputEnvelopeSchema.parse({
        role: 'coder',
        iteration: 0,
        model: '',
        status: 'ok',
        summary: 's',
        payload: {},
      }),
    ).toThrow()
  })
})

describe('Workspace', () => {
  it('parses a valid workspace', () => {
    const w = {
      id: randomUUID(),
      name: 'My Project',
      workspace_root: '/Users/x/proj',
      ui_lang: 'zh-CN',
      preset: 'budget',
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    expect(() => WorkspaceSchema.parse(w)).not.toThrow()
  })

  it('rejects non-uuid id', () => {
    expect(() =>
      WorkspaceSchema.parse({
        id: 'not-a-uuid',
        name: 'x',
        workspace_root: '/x',
        created_at: 0,
        updated_at: 0,
      }),
    ).toThrow()
  })

  it('rejects empty workspace_root', () => {
    expect(() =>
      WorkspaceSchema.parse({
        id: randomUUID(),
        name: 'x',
        workspace_root: '',
        created_at: 0,
        updated_at: 0,
      }),
    ).toThrow()
  })
})

describe('SecretMeta', () => {
  it('parses with all known providers', () => {
    const providers = ['deepseek', 'qwen', 'glm', 'openai-compat', 'anthropic']
    for (const p of providers) {
      expect(() =>
        SecretMetaSchema.parse({
          id: randomUUID(),
          name: 'test',
          provider: p,
          base_url: null,
          available_models: [],
          last_tested_at: null,
          created_at: Date.now(),
        }),
      ).not.toThrow()
    }
  })

  it('rejects unknown provider', () => {
    expect(() =>
      SecretMetaSchema.parse({
        id: randomUUID(),
        name: 'x',
        provider: 'gpt',
        base_url: null,
        available_models: [],
        last_tested_at: null,
        created_at: 0,
      }),
    ).toThrow()
  })
})

describe('RoleAssignment', () => {
  it('allows null secret_id (unconfigured)', () => {
    expect(() =>
      RoleAssignmentSchema.parse({
        role: 'translator',
        secret_id: null,
        model_id: null,
        fallback_secret_id: null,
        fallback_model_id: null,
        custom_prompt_override: null,
      }),
    ).not.toThrow()
  })

  it('accepts a fully configured assignment', () => {
    expect(() =>
      RoleAssignmentSchema.parse({
        role: 'coder',
        secret_id: randomUUID(),
        model_id: 'deepseek-coder',
        fallback_secret_id: randomUUID(),
        fallback_model_id: 'qwen3-coder',
        custom_prompt_override: 'use TypeScript only',
      }),
    ).not.toThrow()
  })
})

describe('ProjectMemory', () => {
  it('emptyProjectMemory produces a valid memory snapshot', () => {
    const m = emptyProjectMemory(randomUUID())
    expect(() => ProjectMemorySchema.parse(m)).not.toThrow()
    expect(m.conventions).toHaveLength(0)
    expect(m.decisions).toHaveLength(0)
    expect(m.design_tokens.spacing.unit).toBe('4px')
  })

  it('accepts a memory with several decisions and tech debt', () => {
    const m = emptyProjectMemory(randomUUID())
    m.decisions.push({
      id: randomUUID(),
      decision: 'use SQLite for V1',
      rationale: 'simplicity, no backend',
      supersedes: null,
      superseded_by: null,
      added_in_iteration: 1,
      added_at: Date.now(),
    })
    m.tech_debt.push({
      id: randomUUID(),
      file: 'src/auth/index.ts',
      issue: 'no rate limiting on login',
      severity: 'high',
      introduced_by_role: 'coder',
      added_in_iteration: 2,
      added_at: Date.now(),
      resolved: false,
      resolved_in_iteration: null,
    })
    expect(() => ProjectMemorySchema.parse(m)).not.toThrow()
  })
})

describe('MemoryUpdateInput', () => {
  it('parses an update with new decisions and conventions', () => {
    const u = {
      add_decisions: [
        {
          decision: 'X',
          rationale: 'Y',
          added_in_iteration: 1,
        },
      ],
      add_conventions: [
        { convention: 'PascalCase for components', scope: 'global', added_in_iteration: 1 },
      ],
    }
    expect(() => MemoryUpdateInputSchema.parse(u)).not.toThrow()
  })

  it('parses a supersession', () => {
    const u = {
      supersede_decisions: [
        {
          old_decision_id: randomUUID(),
          new_decision: {
            decision: 'use Postgres',
            rationale: 'multi-user requires it',
            added_in_iteration: 3,
          },
        },
      ],
    }
    expect(() => MemoryUpdateInputSchema.parse(u)).not.toThrow()
  })
})

describe('TokenUsage + CostRecord', () => {
  it('TokenUsage parses with cached tokens defaulting', () => {
    const u = TokenUsageSchema.parse({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      estimated_cost_usd: 0.001,
    })
    expect(u.cached_input_tokens).toBe(0)
  })

  it('CostRecord round-trip', () => {
    const r = {
      id: randomUUID(),
      workspace_id: randomUUID(),
      iteration_id: randomUUID(),
      role: 'coder',
      provider: 'deepseek',
      model: 'deepseek-coder',
      input_tokens: 200,
      output_tokens: 800,
      cached_input_tokens: 50,
      estimated_cost_usd: 0.0015,
      duration_ms: 4321,
      recorded_at: Date.now(),
    }
    expect(() => CostRecordSchema.parse(r)).not.toThrow()
  })

  it('CostRecord rejects negative tokens', () => {
    expect(() =>
      CostRecordSchema.parse({
        id: randomUUID(),
        workspace_id: randomUUID(),
        iteration_id: randomUUID(),
        role: 'coder',
        provider: 'deepseek',
        model: 'x',
        input_tokens: -1,
        output_tokens: 0,
        estimated_cost_usd: 0,
        duration_ms: 0,
        recorded_at: 0,
      }),
    ).toThrow()
  })
})

describe('IterationRecord', () => {
  it('parses a completed iteration record', () => {
    const r = {
      id: randomUUID(),
      workspace_id: randomUUID(),
      iteration_number: 5,
      user_prompt: 'add login',
      status: 'completed',
      traffic_light: 'green',
      started_at: 1000,
      ended_at: 2000,
      duration_ms: 1000,
      total_cost_usd: 0.05,
      files_changed: ['src/auth/login.ts'],
      role_outputs_json: '{}',
      conflicts_json: '[]',
    }
    expect(() => IterationRecordSchema.parse(r)).not.toThrow()
  })

  it('allows running iteration with null end fields', () => {
    const r = {
      id: randomUUID(),
      workspace_id: randomUUID(),
      iteration_number: 1,
      user_prompt: 'p',
      status: 'running',
      traffic_light: null,
      started_at: 1000,
      ended_at: null,
      duration_ms: null,
      total_cost_usd: null,
      files_changed: [],
      role_outputs_json: '{}',
      conflicts_json: '[]',
    }
    expect(() => IterationRecordSchema.parse(r)).not.toThrow()
  })
})

describe('RoleConflict', () => {
  it('parses a conflict descriptor', () => {
    const c = {
      id: 'CONFLICT-1-001',
      type: 'adversary_flagged_test_passed',
      involved_roles: ['adversary', 'test_runner'],
      severity: 'high',
      description: 'Adversary found XSS but tests passed',
      user_action_required: true,
    }
    expect(() => RoleConflictSchema.parse(c)).not.toThrow()
  })
})

describe('ProviderId', () => {
  it('accepts the 5 V0 providers', () => {
    for (const p of ['deepseek', 'qwen', 'glm', 'openai-compat', 'anthropic']) {
      expect(() => ProviderIdSchema.parse(p)).not.toThrow()
    }
  })
})
