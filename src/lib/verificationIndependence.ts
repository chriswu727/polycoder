// Verification independence checker — pure function. Per ADR-011:
//   * Coder model and Adversary model must differ
//   * Coder model and Test Runner model must differ
// Long-term Critic recommendation is informational, not enforced.

import type { RoleAssignment } from '@core/types/workspace.js'
import type { RoleType } from '@core/types/role.js'

export type VerificationWarning = {
  rule: 'coder_eq_adversary' | 'coder_eq_test_runner'
  detail: string
}

export function checkVerificationIndependence(
  assignments: Record<RoleType, RoleAssignment> | null,
): VerificationWarning[] {
  if (!assignments) return []
  const out: VerificationWarning[] = []

  const coder = assignments.coder
  const adversary = assignments.adversary
  const testRunner = assignments.test_runner

  if (
    coder.secret_id &&
    coder.model_id &&
    adversary.secret_id &&
    adversary.model_id &&
    coder.secret_id === adversary.secret_id &&
    coder.model_id === adversary.model_id
  ) {
    out.push({
      rule: 'coder_eq_adversary',
      detail: `Coder and Adversary use the same (provider, model) — "${coder.model_id}". Adversarial review by the same model is self-review and undermines the multi-model thesis (ADR-011).`,
    })
  }

  if (
    coder.secret_id &&
    coder.model_id &&
    testRunner.secret_id &&
    testRunner.model_id &&
    coder.secret_id === testRunner.secret_id &&
    coder.model_id === testRunner.model_id
  ) {
    out.push({
      rule: 'coder_eq_test_runner',
      detail: `Coder and Test Runner use the same (provider, model) — "${coder.model_id}". A model should not validate its own implementation (ADR-011).`,
    })
  }

  return out
}
