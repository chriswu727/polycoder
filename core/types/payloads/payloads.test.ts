// Spot-test each role's payload schema. Verify happy-path parses
// and a couple of malformed inputs are rejected.

import { describe, it, expect } from 'vitest'
import {
  TranslatorPayloadSchema,
  DesignerPayloadSchema,
  ArchitectPayloadSchema,
  CoderPayloadSchema,
  AdversaryPayloadSchema,
  LongTermCriticPayloadSchema,
  TestRunnerPayloadSchema,
  CommunicatorPayloadSchema,
  PAYLOAD_SCHEMAS,
} from './index.js'
import { ALL_ROLES } from '../role.js'

describe('PAYLOAD_SCHEMAS', () => {
  it('has an entry for every RoleType', () => {
    for (const role of ALL_ROLES) {
      expect(PAYLOAD_SCHEMAS[role]).toBeDefined()
    }
  })
})

describe('TranslatorPayloadSchema', () => {
  it('accepts the canonical example from prompts/01-translator.md', () => {
    const v = TranslatorPayloadSchema.parse({
      intent_summary: 'simple todo',
      must_have: ['add', 'list'],
      should_have: [],
      explicitly_out_of_scope: [],
      ambiguities: [],
      inferred_constraints: [],
      is_iteration: false,
      delta_from_prior: null,
    })
    expect(v.intent_summary).toBe('simple todo')
  })

  it('rejects payload missing intent_summary', () => {
    expect(() =>
      TranslatorPayloadSchema.parse({ must_have: [], should_have: [] }),
    ).toThrow()
  })

  it('passthroughs unknown fields', () => {
    const v = TranslatorPayloadSchema.parse({
      intent_summary: 'x',
      bonus_field: 'kept',
    })
    expect((v as { bonus_field?: string }).bonus_field).toBe('kept')
  })
})

describe('DesignerPayloadSchema', () => {
  it('parses minimal layout-only payload', () => {
    const v = DesignerPayloadSchema.parse({
      layout: {
        primary_view: 'single page',
        navigation_pattern: 'none',
      },
      ui_lang: 'zh-CN',
    })
    expect(v.layout.primary_view).toBe('single page')
  })
})

describe('ArchitectPayloadSchema', () => {
  it('accepts conflict_detected style output (guidance null, conflicts populated)', () => {
    const v = ArchitectPayloadSchema.parse({
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
    })
    expect(v.conflicts).toHaveLength(1)
  })

  it('rejects unknown recommendation enum', () => {
    expect(() =>
      ArchitectPayloadSchema.parse({
        guidance_for_coder: null,
        memory_updates: null,
        conflicts: [
          {
            with: 'x',
            this_iteration_wants: 'y',
            memory_says: 'z',
            recommendation: 'fight_user',
          },
        ],
      }),
    ).toThrow()
  })
})

describe('CoderPayloadSchema', () => {
  it('parses files_changed with action create/edit/delete', () => {
    const v = CoderPayloadSchema.parse({
      files_changed: [
        { path: 'a.ts', action: 'create', reason: 'initial', content_or_diff: '' },
        { path: 'b.ts', action: 'edit', reason: 'fix', content_or_diff: 'diff' },
        { path: 'c.ts', action: 'delete', reason: 'unused', content_or_diff: '' },
      ],
    })
    expect(v.files_changed).toHaveLength(3)
  })
})

describe('AdversaryPayloadSchema', () => {
  it('accepts a clean (no issues) result with explicit negative findings', () => {
    const v = AdversaryPayloadSchema.parse({
      issues: [],
      checked_categories: ['xss', 'race_conditions'],
      explicit_negative_findings: ['React auto-escapes JSX', 'Store mutations are sync'],
      confidence: 'high',
      could_not_assess: [],
    })
    expect(v.issues).toHaveLength(0)
    expect(v.checked_categories).toHaveLength(2)
  })

  it('rejects unknown severity', () => {
    expect(() =>
      AdversaryPayloadSchema.parse({
        issues: [
          {
            id: 'ADV-1',
            severity: 'mega-critical',
            category: 'security',
            where: 'x',
            issue: 'y',
            evidence: 'z',
            suggested_fix: 'w',
          },
        ],
        checked_categories: [],
        explicit_negative_findings: [],
        could_not_assess: [],
      }),
    ).toThrow()
  })
})

describe('LongTermCriticPayloadSchema', () => {
  it('parses minimal healthy snapshot', () => {
    const v = LongTermCriticPayloadSchema.parse({
      health_metrics: { complexity_trend: 'stable' },
      future_stress_predictions: [],
      tech_debt_inventory: [],
      fragility_flags: [],
      refactor_opportunities: [],
      memory_lessons_to_persist: [],
    })
    expect(v.health_metrics?.complexity_trend).toBe('stable')
  })
})

describe('TestRunnerPayloadSchema', () => {
  it('parses passed run with test_run populated', () => {
    const v = TestRunnerPayloadSchema.parse({
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
    })
    expect(v.test_run?.passed_count).toBe(5)
  })

  it('parses cannot_run state with test_run null', () => {
    const v = TestRunnerPayloadSchema.parse({
      tests_written: [],
      test_run: null,
      failures: [],
      coverage_assessment: {
        coverage_adequacy: 'inadequate',
        blockers_for_full_coverage: ['no test framework'],
      },
      follow_up_for_coder: ['install vitest'],
    })
    expect(v.test_run).toBeNull()
  })
})

describe('CommunicatorPayloadSchema', () => {
  it('requires user_facing_text', () => {
    expect(() =>
      CommunicatorPayloadSchema.parse({
        traffic_light: 'green',
      }),
    ).toThrow()
  })

  it('parses a green-light payload with no disagreements', () => {
    const v = CommunicatorPayloadSchema.parse({
      user_facing_text: '✓ done',
      traffic_light: 'green',
      traffic_light_reason: 'all checks pass',
    })
    expect(v.traffic_light).toBe('green')
  })

  it('parses a yellow-light payload with disagreement card', () => {
    const v = CommunicatorPayloadSchema.parse({
      user_facing_text: 'yellow',
      traffic_light: 'yellow',
      traffic_light_reason: 'reviewer disagreement',
      disagreement_cards: [
        {
          card_id: 'DIS-1',
          between: ['adversary', 'test_runner'],
          topic: 'auth rate limit',
          stances: [
            { role: 'adversary', stance: 'add limit', model_label: 'Qwen-Max' },
            { role: 'test_runner', stance: 'tests pass', model_label: 'DeepSeek' },
          ],
          user_action_required: 'decide',
          default_if_user_skips: 'no limit',
        },
      ],
    })
    expect(v.disagreement_cards).toHaveLength(1)
  })
})
