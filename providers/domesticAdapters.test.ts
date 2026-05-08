// Tests for the three domestic adapters. Each verifies:
//   1. Default base URL applied
//   2. id matches the provider
//   3. Model catalog populated
//   4. (Where applicable) provider-specific quirks are honored

import { describe, it, expect } from 'vitest'
import { DeepSeekProvider, DEEPSEEK_DEFAULT_BASE_URL } from './DeepSeekProvider.js'
import { QwenProvider, QWEN_DEFAULT_BASE_URL } from './QwenProvider.js'
import { GLMProvider, GLM_DEFAULT_BASE_URL } from './GLMProvider.js'
import {
  DEEPSEEK_MODELS,
  QWEN_MODELS,
  GLM_MODELS,
} from './modelCatalogs.js'
import type { FetchImpl } from './httpClient.js'

function captureFetch(): {
  fetchImpl: FetchImpl
  capturedBody: () => Record<string, unknown> | null
} {
  let last: Record<string, unknown> | null = null
  const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => {
    if (init?.body) {
      last = JSON.parse(init.body as string) as Record<string, unknown>
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'r',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
  }) as FetchImpl
  return { fetchImpl, capturedBody: () => last }
}

describe('DeepSeekProvider', () => {
  it('id is "deepseek"', () => {
    const p = new DeepSeekProvider({ apiKey: 'k' })
    expect(p.id).toBe('deepseek')
  })

  it('uses DeepSeek default base_url', () => {
    const p = new DeepSeekProvider({ apiKey: 'k' })
    expect(p.base_url).toBe(DEEPSEEK_DEFAULT_BASE_URL)
  })

  it('listModels returns the hardcoded catalog', async () => {
    const p = new DeepSeekProvider({ apiKey: 'k' })
    const models = await p.listModels()
    expect(models.map((m) => m.id)).toEqual(
      DEEPSEEK_MODELS.map((m) => m.id),
    )
  })

  it('honors a custom baseUrl override (for self-hosted / proxy)', () => {
    const p = new DeepSeekProvider({
      apiKey: 'k',
      baseUrl: 'https://my-proxy.example.com',
    })
    expect(p.base_url).toBe('https://my-proxy.example.com')
  })
})

describe('QwenProvider', () => {
  it('id is "qwen" and uses DashScope compat base_url', () => {
    const p = new QwenProvider({ apiKey: 'k' })
    expect(p.id).toBe('qwen')
    expect(p.base_url).toBe(QWEN_DEFAULT_BASE_URL)
  })

  it('listModels returns Qwen catalog including vision model', async () => {
    const p = new QwenProvider({ apiKey: 'k' })
    const models = await p.listModels()
    expect(models.map((m) => m.id)).toEqual(QWEN_MODELS.map((m) => m.id))
    const vlMax = models.find((m) => m.id === 'qwen-vl-max')
    expect(vlMax?.capabilities.supports_vision).toBe(true)
  })

  it('chat sends enable_search:false in the body', async () => {
    const cap = captureFetch()
    const p = new QwenProvider({
      apiKey: 'k',
      fetchImpl: cap.fetchImpl,
    })
    await p.chat({ model: 'qwen-plus', messages: [{ role: 'user', content: 'x' }] })
    const body = cap.capturedBody()
    expect(body?.enable_search).toBe(false)
  })
})

describe('GLMProvider', () => {
  it('id is "glm" and uses Zhipu base_url', () => {
    const p = new GLMProvider({ apiKey: 'k' })
    expect(p.id).toBe('glm')
    expect(p.base_url).toBe(GLM_DEFAULT_BASE_URL)
  })

  it('listModels returns GLM catalog including free-tier flash', async () => {
    const p = new GLMProvider({ apiKey: 'k' })
    const models = await p.listModels()
    expect(models.map((m) => m.id)).toEqual(GLM_MODELS.map((m) => m.id))
    const flash = models.find((m) => m.id === 'glm-4-flash')
    expect(flash?.cost_per_million_input_tokens).toBe(0)
    expect(flash?.cost_per_million_output_tokens).toBe(0)
  })
})
