import { describe, it, expect } from 'vitest'
import { checkVerificationIndependence } from './verificationIndependence.js'
import type { RoleAssignment } from '@core/types/workspace.js'
import type { RoleType } from '@core/types/role.js'

function emptyAssignments(): Record<RoleType, RoleAssignment> {
  const empty = (role: RoleType): RoleAssignment => ({
    role,
    secret_id: null,
    model_id: null,
    fallback_secret_id: null,
    fallback_model_id: null,
    custom_prompt_override: null,
  })
  return {
    translator: empty('translator'),
    designer: empty('designer'),
    architect: empty('architect'),
    coder: empty('coder'),
    adversary: empty('adversary'),
    long_term_critic: empty('long_term_critic'),
    test_runner: empty('test_runner'),
    communicator: empty('communicator'),
  }
}

describe('checkVerificationIndependence', () => {
  it('returns empty array when assignments is null', () => {
    expect(checkVerificationIndependence(null)).toEqual([])
  })

  it('returns empty array when no roles configured', () => {
    expect(checkVerificationIndependence(emptyAssignments())).toEqual([])
  })

  it('flags coder_eq_adversary when same (secret, model)', () => {
    const a = emptyAssignments()
    a.coder.secret_id = 's-1'
    a.coder.model_id = 'deepseek-coder'
    a.adversary.secret_id = 's-1'
    a.adversary.model_id = 'deepseek-coder'

    const ws = checkVerificationIndependence(a)
    expect(ws).toHaveLength(1)
    expect(ws[0]?.rule).toBe('coder_eq_adversary')
  })

  it('does NOT flag when same secret but different model', () => {
    const a = emptyAssignments()
    a.coder.secret_id = 's-1'
    a.coder.model_id = 'deepseek-coder'
    a.adversary.secret_id = 's-1'
    a.adversary.model_id = 'deepseek-reasoner'
    expect(checkVerificationIndependence(a)).toHaveLength(0)
  })

  it('does NOT flag when different secrets but same model name (different providers, hypothetical)', () => {
    const a = emptyAssignments()
    a.coder.secret_id = 's-deepseek'
    a.coder.model_id = 'deepseek-chat'
    a.adversary.secret_id = 's-other-deepseek'
    a.adversary.model_id = 'deepseek-chat'
    // Same model name but different secret rows ≠ same logical assignment.
    // Per the rule we only flag if BOTH secret_id and model_id match.
    expect(checkVerificationIndependence(a)).toHaveLength(0)
  })

  it('flags coder_eq_test_runner', () => {
    const a = emptyAssignments()
    a.coder.secret_id = 's-1'
    a.coder.model_id = 'deepseek-coder'
    a.test_runner.secret_id = 's-1'
    a.test_runner.model_id = 'deepseek-coder'

    const ws = checkVerificationIndependence(a)
    expect(ws).toHaveLength(1)
    expect(ws[0]?.rule).toBe('coder_eq_test_runner')
  })

  it('flags both rules independently', () => {
    const a = emptyAssignments()
    a.coder.secret_id = 's-1'
    a.coder.model_id = 'deepseek-coder'
    a.adversary.secret_id = 's-1'
    a.adversary.model_id = 'deepseek-coder'
    a.test_runner.secret_id = 's-1'
    a.test_runner.model_id = 'deepseek-coder'

    const ws = checkVerificationIndependence(a)
    expect(ws).toHaveLength(2)
    expect(ws.map((w) => w.rule).sort()).toEqual([
      'coder_eq_adversary',
      'coder_eq_test_runner',
    ])
  })

  it('does NOT flag when Coder is unconfigured', () => {
    const a = emptyAssignments()
    a.adversary.secret_id = 's-1'
    a.adversary.model_id = 'deepseek-coder'
    a.test_runner.secret_id = 's-1'
    a.test_runner.model_id = 'deepseek-coder'
    expect(checkVerificationIndependence(a)).toHaveLength(0)
  })
})
