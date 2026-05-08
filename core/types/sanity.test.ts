// Sanity test — proves the test runner is wired. Replaced/removed once
// real tests land in Layer B+.

import { describe, it, expect } from 'vitest'

describe('test harness sanity', () => {
  it('vitest runs', () => {
    expect(1 + 1).toBe(2)
  })

  it('TS strict mode is honored', () => {
    const x: string = 'polycoder'
    expect(x).toHaveLength(9)
  })
})
