import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { HydratedSecret } from '@core/types/workspace.js'
import { buildProvider } from './registry.js'
import { DeepSeekProvider } from './DeepSeekProvider.js'
import { QwenProvider } from './QwenProvider.js'
import { GLMProvider } from './GLMProvider.js'
import { AnthropicProvider } from './AnthropicProvider.js'
import { OpenAICompatProvider } from './OpenAICompatProvider.js'

function secret(provider: HydratedSecret['provider'], baseUrl: string | null = null): HydratedSecret {
  return {
    id: randomUUID(),
    name: 'test-secret',
    provider,
    api_key: 'sk-test',
    base_url: baseUrl,
    available_models: [],
    last_tested_at: null,
    created_at: Date.now(),
  }
}

describe('buildProvider', () => {
  it('builds DeepSeekProvider for provider=deepseek', () => {
    const p = buildProvider(secret('deepseek'))
    expect(p).toBeInstanceOf(DeepSeekProvider)
    expect(p.id).toBe('deepseek')
  })

  it('builds QwenProvider for provider=qwen', () => {
    const p = buildProvider(secret('qwen'))
    expect(p).toBeInstanceOf(QwenProvider)
    expect(p.id).toBe('qwen')
  })

  it('builds GLMProvider for provider=glm', () => {
    const p = buildProvider(secret('glm'))
    expect(p).toBeInstanceOf(GLMProvider)
    expect(p.id).toBe('glm')
  })

  it('builds AnthropicProvider for provider=anthropic', () => {
    const p = buildProvider(secret('anthropic'))
    expect(p).toBeInstanceOf(AnthropicProvider)
    expect(p.id).toBe('anthropic')
  })

  it('builds OpenAICompatProvider when openai-compat + base_url provided', () => {
    const p = buildProvider(secret('openai-compat', 'https://my-vllm.example.com'))
    expect(p).toBeInstanceOf(OpenAICompatProvider)
    expect(p.id).toBe('openai-compat')
    expect(p.base_url).toBe('https://my-vllm.example.com')
  })

  it('throws when openai-compat secret has no base_url', () => {
    expect(() => buildProvider(secret('openai-compat', null))).toThrow(
      /requires base_url/i,
    )
  })

  it('honors per-provider base_url override (e.g. China-friendly proxy for Anthropic)', () => {
    const p = buildProvider(secret('anthropic', 'https://my-anthropic-proxy.example.com'))
    expect(p.base_url).toBe('https://my-anthropic-proxy.example.com')
  })
})
