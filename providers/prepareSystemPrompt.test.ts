import { describe, it, expect } from 'vitest'
import {
  prepareForOpenAICompat,
  prepareForAnthropic,
  POLYCODER_PROMPT_BOUNDARY,
} from './prepareSystemPrompt.js'

const STATIC = 'You are the Translator.\nDo X.'
const DYNAMIC = 'Iteration 5 context: ...'
const FULL = `${STATIC}\n${POLYCODER_PROMPT_BOUNDARY}\n${DYNAMIC}`

describe('prepareForOpenAICompat', () => {
  it('strips the boundary marker', () => {
    const out = prepareForOpenAICompat(FULL)
    expect(out.text).not.toContain(POLYCODER_PROMPT_BOUNDARY)
    expect(out.text).toContain('You are the Translator.')
    expect(out.text).toContain('Iteration 5')
  })

  it('returns input unchanged when no marker is present', () => {
    const out = prepareForOpenAICompat('plain prompt')
    expect(out.text).toBe('plain prompt')
  })
})

describe('prepareForAnthropic', () => {
  it('splits on the marker into two blocks; first gets cache_control', () => {
    const blocks = prepareForAnthropic(FULL)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.cache_control).toEqual({ type: 'ephemeral' })
    expect(blocks[0]?.text).toContain('You are the Translator.')
    expect(blocks[1]?.cache_control).toBeUndefined()
    expect(blocks[1]?.text).toContain('Iteration 5')
  })

  it('returns single block when no marker', () => {
    const blocks = prepareForAnthropic('flat prompt')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.text).toBe('flat prompt')
    expect(blocks[0]?.cache_control).toBeUndefined()
  })

  it('elides empty halves', () => {
    const onlyAfter = `${POLYCODER_PROMPT_BOUNDARY}\nlater`
    const blocks = prepareForAnthropic(onlyAfter)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.text).toBe('later')
    // No cache_control because there's nothing static to cache.
    expect(blocks[0]?.cache_control).toBeUndefined()

    const onlyBefore = `static\n${POLYCODER_PROMPT_BOUNDARY}\n  `
    const blocks2 = prepareForAnthropic(onlyBefore)
    expect(blocks2).toHaveLength(1)
    expect(blocks2[0]?.text).toBe('static')
    expect(blocks2[0]?.cache_control).toEqual({ type: 'ephemeral' })
  })
})
