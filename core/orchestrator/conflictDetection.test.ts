// Table-driven tests for detectConflicts. Each row sets up the
// minimum subset of role outputs needed to trigger (or NOT trigger)
// a specific rule.

import { describe, it, expect } from 'vitest'
import { detectConflicts, type AllRoleOutputs } from './conflictDetection.js'
import type { RoleOutputEnvelope } from '@core/types/role.js'

function envelope<P>(
  role: RoleOutputEnvelope['role'],
  status: RoleOutputEnvelope['status'],
  payload: P,
): RoleOutputEnvelope {
  return {
    role,
    iteration: 1,
    model: 'm',
    status,
    summary: '',
    payload,
  }
}

describe('detectConflicts — R1: adversary_flagged_test_passed', () => {
  it('fires when adversary has high+ AND test_runner passed', () => {
    const outputs: AllRoleOutputs = {
      adversary: envelope('adversary', 'flagged', {
        issues: [
          {
            id: 'A-1',
            severity: 'high',
            category: 'security',
            where: 'src/x.ts:5',
            issue: 'XSS vector',
            evidence: 'evidence',
            suggested_fix: 'escape it',
          },
        ],
        checked_categories: [],
        explicit_negative_findings: [],
        confidence: 'high',
        could_not_assess: [],
      }),
      test_runner: envelope('test_runner', 'passed', {
        tests_written: [],
        test_run: null,
        failures: [],
        coverage_assessment: { coverage_adequacy: 'good' },
        follow_up_for_coder: [],
      }),
    }
    const cs = detectConflicts({ outputs, iteration_number: 1 })
    expect(cs).toHaveLength(1)
    expect(cs[0]?.type).toBe('adversary_flagged_test_passed')
    expect(cs[0]?.severity).toBe('high')
    expect(cs[0]?.user_action_required).toBe(true)
  })

  it('does NOT fire when adversary has only low/medium issues', () => {
    const outputs: AllRoleOutputs = {
      adversary: envelope('adversary', 'flagged', {
        issues: [
          {
            id: 'A-1',
            severity: 'low',
            category: 'style',
            where: 'x',
            issue: 'y',
            evidence: 'z',
            suggested_fix: 'w',
          },
        ],
        checked_categories: [],
        explicit_negative_findings: [],
        confidence: 'medium',
        could_not_assess: [],
      }),
      test_runner: envelope('test_runner', 'passed', {
        tests_written: [],
        test_run: null,
        failures: [],
        coverage_assessment: { coverage_adequacy: 'good' },
        follow_up_for_coder: [],
      }),
    }
    expect(detectConflicts({ outputs, iteration_number: 1 })).toHaveLength(0)
  })

  it('does NOT fire when test_runner has not passed', () => {
    const outputs: AllRoleOutputs = {
      adversary: envelope('adversary', 'flagged', {
        issues: [
          {
            id: 'A-1',
            severity: 'high',
            category: 'security',
            where: 'x',
            issue: 'y',
            evidence: 'z',
            suggested_fix: 'w',
          },
        ],
        checked_categories: [],
        explicit_negative_findings: [],
        confidence: 'high',
        could_not_assess: [],
      }),
      test_runner: envelope('test_runner', 'failed', {
        tests_written: [],
        test_run: null,
        failures: [],
        coverage_assessment: { coverage_adequacy: 'good' },
        follow_up_for_coder: [],
      }),
    }
    const cs = detectConflicts({ outputs, iteration_number: 1 })
    // Should not match R1; might match R2 if Coder claimed ok.
    expect(cs.find((c) => c.type === 'adversary_flagged_test_passed')).toBeUndefined()
  })
})

describe('detectConflicts — R2: test_failed_coder_ok', () => {
  it('fires when Coder ok but Test Runner failed', () => {
    const outputs: AllRoleOutputs = {
      coder: envelope('coder', 'ok', { files_changed: [], files_skipped: [], uncertainties: [], follow_up_needed: [] }),
      test_runner: envelope('test_runner', 'failed', {
        tests_written: [],
        test_run: null,
        failures: [{ test_name: 't', file: 'f', implication: 'fix it' }],
        coverage_assessment: { coverage_adequacy: 'good' },
        follow_up_for_coder: [],
      }),
    }
    const cs = detectConflicts({ outputs, iteration_number: 1 })
    expect(cs).toHaveLength(1)
    expect(cs[0]?.type).toBe('test_failed_coder_ok')
    expect(cs[0]?.severity).toBe('critical')
  })

  it('does NOT fire when Coder reports partial', () => {
    const outputs: AllRoleOutputs = {
      coder: envelope('coder', 'partial', { files_changed: [], files_skipped: [], uncertainties: [], follow_up_needed: [] }),
      test_runner: envelope('test_runner', 'failed', {
        tests_written: [],
        test_run: null,
        failures: [],
        coverage_assessment: { coverage_adequacy: 'good' },
        follow_up_for_coder: [],
      }),
    }
    expect(
      detectConflicts({ outputs, iteration_number: 1 }).find(
        (c) => c.type === 'test_failed_coder_ok',
      ),
    ).toBeUndefined()
  })
})

describe('detectConflicts — R3: architect_overridden_silently', () => {
  it('fires when coder.architect_disagreement is populated', () => {
    const outputs: AllRoleOutputs = {
      coder: envelope('coder', 'partial', {
        files_changed: [],
        files_skipped: [],
        uncertainties: [],
        follow_up_needed: [],
        architect_disagreement: {
          with_pattern: 'patterns_to_follow[0]',
          reason: 'Zustand persist does not support debounce natively',
          what_i_did_instead: 'Manual setTimeout in store mutations',
        },
      }),
    }
    const cs = detectConflicts({ outputs, iteration_number: 1 })
    expect(cs).toHaveLength(1)
    expect(cs[0]?.type).toBe('architect_overridden_silently')
    expect(cs[0]?.description).toContain('Zustand persist')
  })
})

describe('detectConflicts — R4: reviewers_disagree_on_severity', () => {
  it('fires when adversary critical AND long_term_critic healthy', () => {
    const outputs: AllRoleOutputs = {
      adversary: envelope('adversary', 'flagged', {
        issues: [
          {
            id: 'A-1',
            severity: 'critical',
            category: 'security',
            where: 'x',
            issue: 'y',
            evidence: 'z',
            suggested_fix: 'w',
          },
        ],
        checked_categories: [],
        explicit_negative_findings: [],
        confidence: 'high',
        could_not_assess: [],
      }),
      long_term_critic: envelope('long_term_critic', 'healthy', {
        future_stress_predictions: [],
        tech_debt_inventory: [],
        fragility_flags: [],
        refactor_opportunities: [],
        memory_lessons_to_persist: [],
      }),
    }
    const cs = detectConflicts({ outputs, iteration_number: 1 })
    expect(
      cs.find((c) => c.type === 'reviewers_disagree_on_severity'),
    ).toBeDefined()
  })
})

describe('detectConflicts — R5: critic_warns_coder_proceeds', () => {
  it('fires with severity:medium for warning', () => {
    const outputs: AllRoleOutputs = {
      long_term_critic: envelope('long_term_critic', 'warning', {
        future_stress_predictions: [],
        tech_debt_inventory: [],
        fragility_flags: [],
        refactor_opportunities: [],
        memory_lessons_to_persist: [],
      }),
    }
    const cs = detectConflicts({ outputs, iteration_number: 1 })
    expect(cs).toHaveLength(1)
    expect(cs[0]?.type).toBe('critic_warns_coder_proceeds')
    expect(cs[0]?.severity).toBe('medium')
    expect(cs[0]?.user_action_required).toBe(false)
  })

  it('fires with severity:high + user_action_required for critical', () => {
    const outputs: AllRoleOutputs = {
      long_term_critic: envelope('long_term_critic', 'critical', {
        future_stress_predictions: [],
        tech_debt_inventory: [],
        fragility_flags: [],
        refactor_opportunities: [],
        memory_lessons_to_persist: [],
      }),
    }
    const cs = detectConflicts({ outputs, iteration_number: 1 })
    expect(cs[0]?.severity).toBe('high')
    expect(cs[0]?.user_action_required).toBe(true)
  })

  it('does NOT fire when long_term_critic is healthy', () => {
    const outputs: AllRoleOutputs = {
      long_term_critic: envelope('long_term_critic', 'healthy', {
        future_stress_predictions: [],
        tech_debt_inventory: [],
        fragility_flags: [],
        refactor_opportunities: [],
        memory_lessons_to_persist: [],
      }),
    }
    expect(
      detectConflicts({ outputs, iteration_number: 1 }).find(
        (c) => c.type === 'critic_warns_coder_proceeds',
      ),
    ).toBeUndefined()
  })
})

describe('detectConflicts — combined scenarios', () => {
  it('returns empty when everything is fine', () => {
    const outputs: AllRoleOutputs = {
      coder: envelope('coder', 'ok', { files_changed: [], files_skipped: [], uncertainties: [], follow_up_needed: [] }),
      adversary: envelope('adversary', 'clean', {
        issues: [],
        checked_categories: ['x'],
        explicit_negative_findings: [],
        confidence: 'high',
        could_not_assess: [],
      }),
      long_term_critic: envelope('long_term_critic', 'healthy', {
        future_stress_predictions: [],
        tech_debt_inventory: [],
        fragility_flags: [],
        refactor_opportunities: [],
        memory_lessons_to_persist: [],
      }),
      test_runner: envelope('test_runner', 'passed', {
        tests_written: [],
        test_run: null,
        failures: [],
        coverage_assessment: { coverage_adequacy: 'good' },
        follow_up_for_coder: [],
      }),
    }
    expect(detectConflicts({ outputs, iteration_number: 1 })).toHaveLength(0)
  })

  it('fires multiple conflicts when multiple rules match', () => {
    const outputs: AllRoleOutputs = {
      coder: envelope('coder', 'ok', {
        files_changed: [],
        files_skipped: [],
        uncertainties: [],
        follow_up_needed: [],
        architect_disagreement: {
          with_pattern: 'patterns_to_follow[0]',
          reason: 'r',
          what_i_did_instead: 'w',
        },
      }),
      test_runner: envelope('test_runner', 'failed', {
        tests_written: [],
        test_run: null,
        failures: [],
        coverage_assessment: { coverage_adequacy: 'good' },
        follow_up_for_coder: [],
      }),
      long_term_critic: envelope('long_term_critic', 'warning', {
        future_stress_predictions: [],
        tech_debt_inventory: [],
        fragility_flags: [],
        refactor_opportunities: [],
        memory_lessons_to_persist: [],
      }),
    }
    const cs = detectConflicts({ outputs, iteration_number: 1 })
    expect(cs.length).toBeGreaterThanOrEqual(3)
    expect(cs.map((c) => c.type)).toEqual(
      expect.arrayContaining([
        'test_failed_coder_ok',
        'architect_overridden_silently',
        'critic_warns_coder_proceeds',
      ]),
    )
  })

  it('every conflict has a unique id within an iteration', () => {
    const outputs: AllRoleOutputs = {
      coder: envelope('coder', 'ok', { files_changed: [], files_skipped: [], uncertainties: [], follow_up_needed: [] }),
      test_runner: envelope('test_runner', 'failed', {
        tests_written: [],
        test_run: null,
        failures: [],
        coverage_assessment: { coverage_adequacy: 'good' },
        follow_up_for_coder: [],
      }),
      long_term_critic: envelope('long_term_critic', 'warning', {
        future_stress_predictions: [],
        tech_debt_inventory: [],
        fragility_flags: [],
        refactor_opportunities: [],
        memory_lessons_to_persist: [],
      }),
    }
    const cs = detectConflicts({ outputs, iteration_number: 5 })
    const ids = cs.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toMatch(/^CONFLICT-5-/)
  })
})
