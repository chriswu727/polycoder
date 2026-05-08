// detectConflicts — pure function that scans all role outputs and
// emits a list of cross-role conflicts. Per docs/specs/orchestrator.md
// §5. The 5 rules (R1-R5 in inline comments) are stable; new rules
// must be added with a new conflict type + bumped severity logic.

import { randomUUID } from 'node:crypto'
import type { RoleType, RoleOutputEnvelope } from '@core/types/role.js'
import type { RoleConflict } from '@core/types/iteration.js'
import type { AdversaryPayload } from '@core/types/payloads/adversary.js'
import type { CoderPayload } from '@core/types/payloads/coder.js'

export type AllRoleOutputs = Partial<Record<RoleType, RoleOutputEnvelope>>

export type DetectConflictsArgs = {
  outputs: AllRoleOutputs
  iteration_number: number
}

export function detectConflicts(args: DetectConflictsArgs): RoleConflict[] {
  const { outputs, iteration_number } = args
  const conflicts: RoleConflict[] = []
  let nextId = 1
  const newId = () =>
    `CONFLICT-${iteration_number}-${String(nextId++).padStart(3, '0')}`

  const adversary = outputs.adversary
  const testRunner = outputs.test_runner
  const coder = outputs.coder
  const longTerm = outputs.long_term_critic

  const adversaryPayload = adversary?.payload as AdversaryPayload | undefined
  const coderPayload = coder?.payload as CoderPayload | undefined

  const adversaryHighOrCritical =
    adversaryPayload?.issues?.filter(
      (i) => i.severity === 'high' || i.severity === 'critical',
    ) ?? []
  const adversaryHasCritical =
    adversaryPayload?.issues?.some((i) => i.severity === 'critical') ?? false

  // ─── R1: adversary_flagged_test_passed ──────────────────────────
  // High/critical adversary issues but test_runner reports "passed".
  if (adversaryHighOrCritical.length > 0 && testRunner?.status === 'passed') {
    conflicts.push({
      id: newId(),
      type: 'adversary_flagged_test_passed',
      involved_roles: ['adversary', 'test_runner'],
      severity: 'high',
      description: `Adversary flagged ${adversaryHighOrCritical.length} high/critical issue(s) but Test Runner reported all tests passing.`,
      user_action_required: true,
    })
  }

  // ─── R2: test_failed_coder_ok ───────────────────────────────────
  // Coder claimed status:'ok' but Test Runner failed.
  if (coder?.status === 'ok' && testRunner?.status === 'failed') {
    conflicts.push({
      id: newId(),
      type: 'test_failed_coder_ok',
      involved_roles: ['coder', 'test_runner'],
      severity: 'critical',
      description:
        'Coder reported status:ok but Test Runner reported failed tests. Coder must have missed something.',
      user_action_required: true,
    })
  }

  // ─── R3: architect_overridden_silently ─────────────────────────
  // Coder's architect_disagreement field was populated.
  if (coderPayload?.architect_disagreement) {
    const disagreement = coderPayload.architect_disagreement
    conflicts.push({
      id: newId(),
      type: 'architect_overridden_silently',
      involved_roles: ['architect', 'coder'],
      severity: 'medium',
      description: `Coder disagreed with Architect's pattern (${disagreement.with_pattern}). Reason: ${disagreement.reason}`,
      user_action_required: true,
    })
  }

  // ─── R4: reviewers_disagree_on_severity ────────────────────────
  // Adversary said "critical" while Long-term Critic said "healthy".
  if (
    adversaryHasCritical &&
    longTerm?.status === 'healthy'
  ) {
    conflicts.push({
      id: newId(),
      type: 'reviewers_disagree_on_severity',
      involved_roles: ['adversary', 'long_term_critic'],
      severity: 'medium',
      description:
        'Adversary flagged a critical issue, but Long-term Critic reported healthy. Reviewers disagree on severity.',
      user_action_required: true,
    })
  }

  // ─── R5: critic_warns_coder_proceeds ───────────────────────────
  // Long-term Critic reported warning or critical (Coder proceeded
  // anyway, since this rule fires regardless of Coder's status —
  // the Coder doesn't know about long-term concerns).
  if (longTerm?.status === 'warning' || longTerm?.status === 'critical') {
    const isCritical = longTerm.status === 'critical'
    conflicts.push({
      id: newId(),
      type: 'critic_warns_coder_proceeds',
      involved_roles: ['long_term_critic', 'coder'],
      severity: isCritical ? 'high' : 'medium',
      description: isCritical
        ? 'Long-term Critic reported a critical architectural fragility. The current iteration may compromise the project.'
        : 'Long-term Critic reported a warning about long-term health (tech debt or fragility).',
      user_action_required: isCritical,
    })
  }

  return conflicts
}

/**
 * Helper for tests + downstream code to assert ordering.
 */
export const CONFLICT_TYPE_ORDER: Record<RoleConflict['type'], number> = {
  adversary_flagged_test_passed: 1,
  test_failed_coder_ok: 2,
  architect_overridden_silently: 3,
  reviewers_disagree_on_severity: 4,
  critic_warns_coder_proceeds: 5,
}

void randomUUID // keep import for future use; remove once we generate UUIDs here
