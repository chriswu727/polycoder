import { describe, it, expect } from 'vitest'
import {
  detectSynthesisDiscipline,
  synthesisDisciplineRePrompt,
} from './synthesisDiscipline.js'

describe('detectSynthesisDiscipline', () => {
  it('flags "based on the prior findings"', () => {
    const v = detectSynthesisDiscipline(
      'Based on the prior findings, we should refactor.',
    )
    expect(v).toHaveLength(1)
    expect(v[0]?.matched.toLowerCase()).toContain('based on')
  })

  it('flags "per the Translator"', () => {
    const v = detectSynthesisDiscipline('Per the Translator output, do X.')
    expect(v).toHaveLength(1)
  })

  it('flags "as discussed above"', () => {
    const v = detectSynthesisDiscipline(
      'As discussed above, the auth pattern is established.',
    )
    expect(v.length).toBeGreaterThanOrEqual(1)
  })

  it('flags "following the patterns identified earlier"', () => {
    const v = detectSynthesisDiscipline(
      'Following the patterns identified earlier, this should work.',
    )
    expect(v).toHaveLength(1)
  })

  it('does NOT flag concrete restatements', () => {
    const text =
      'Coder: write src/store/tasks.ts using Zustand with debounced localStorage.'
    expect(detectSynthesisDiscipline(text)).toEqual([])
  })

  it('is case-insensitive', () => {
    const v = detectSynthesisDiscipline('BASED ON THE PRIOR ANALYSIS, do X.')
    expect(v).toHaveLength(1)
  })

  it('returns empty when no phrases match', () => {
    expect(detectSynthesisDiscipline('Some other text.')).toEqual([])
  })
})

describe('synthesisDisciplineRePrompt', () => {
  it('includes a sample of the violations', () => {
    const v = detectSynthesisDiscipline('Based on the prior analysis, do X.')
    const prompt = synthesisDisciplineRePrompt(v)
    expect(prompt).toContain('synthesis-discipline')
    expect(prompt).toContain('Based on the prior analysis')
    expect(prompt).toContain('ADR-012')
  })

  it('caps the sample list at 3', () => {
    const violations = Array.from({ length: 10 }, (_v, i) => ({
      phrase: `pattern-${i}`,
      matched: `match-${i}`,
    }))
    const prompt = synthesisDisciplineRePrompt(violations)
    expect(prompt.split('\n').filter((l) => l.includes('match-')).length).toBe(3)
  })
})
