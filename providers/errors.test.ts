import { describe, it, expect } from 'vitest'
import { ProviderError, classifyHttpStatus } from './errors.js'

describe('ProviderError', () => {
  it('captures all metadata', () => {
    const e = new ProviderError(
      'rate_limited',
      'deepseek',
      'deepseek-chat',
      'Rate limited',
      true,
      5000,
      { headers: { 'retry-after': '5' } },
    )
    expect(e.code).toBe('rate_limited')
    expect(e.providerId).toBe('deepseek')
    expect(e.modelId).toBe('deepseek-chat')
    expect(e.message).toBe('Rate limited')
    expect(e.retryable).toBe(true)
    expect(e.retry_after_ms).toBe(5000)
    expect(e.name).toBe('ProviderError')
  })

  it('is throwable and instanceof Error', () => {
    expect(() => {
      throw new ProviderError('auth_failed', 'qwen', 'm', 'bad key', false)
    }).toThrow(ProviderError)
  })
})

describe('classifyHttpStatus', () => {
  it('401/403 → auth_failed not retryable', () => {
    expect(classifyHttpStatus(401)).toEqual({ code: 'auth_failed', retryable: false })
    expect(classifyHttpStatus(403)).toEqual({ code: 'auth_failed', retryable: false })
  })

  it('429 → rate_limited retryable', () => {
    expect(classifyHttpStatus(429)).toEqual({ code: 'rate_limited', retryable: true })
  })

  it('400 → invalid_request not retryable', () => {
    expect(classifyHttpStatus(400)).toEqual({ code: 'invalid_request', retryable: false })
  })

  it('5xx → service_unavailable retryable', () => {
    expect(classifyHttpStatus(500)).toEqual({ code: 'service_unavailable', retryable: true })
    expect(classifyHttpStatus(502)).toEqual({ code: 'service_unavailable', retryable: true })
    expect(classifyHttpStatus(599)).toEqual({ code: 'service_unavailable', retryable: true })
  })

  it('anything else → unknown not retryable', () => {
    expect(classifyHttpStatus(200)).toEqual({ code: 'unknown', retryable: false })
    expect(classifyHttpStatus(307)).toEqual({ code: 'unknown', retryable: false })
  })
})
