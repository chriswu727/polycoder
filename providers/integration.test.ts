// Opt-in integration tests against real provider APIs.
//
// These tests are SKIPPED by default. Enable per-provider by setting
// the corresponding env var to a real API key:
//
//   POLYCODER_INT_TEST_DEEPSEEK_KEY=...   pnpm test integration
//   POLYCODER_INT_TEST_QWEN_KEY=...       pnpm test integration
//   POLYCODER_INT_TEST_GLM_KEY=...        pnpm test integration
//   POLYCODER_INT_TEST_ANTHROPIC_KEY=...  pnpm test integration
//
// CI never runs these — they cost real money and require secrets.
// Local-dev validation only.

import { describe, it, expect } from 'vitest'
import { DeepSeekProvider } from './DeepSeekProvider.js'
import { QwenProvider } from './QwenProvider.js'
import { GLMProvider } from './GLMProvider.js'
import { AnthropicProvider } from './AnthropicProvider.js'

const envOrSkip = (varName: string): string | null => {
  const v = process.env[varName]
  return v && v.length > 0 ? v : null
}

describe.runIf(envOrSkip('POLYCODER_INT_TEST_DEEPSEEK_KEY') !== null)(
  'DeepSeekProvider integration',
  () => {
    const apiKey = envOrSkip('POLYCODER_INT_TEST_DEEPSEEK_KEY')!
    it(
      'completes a 1-token request',
      async () => {
        const p = new DeepSeekProvider({ apiKey })
        const resp = await p.chat({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'reply with the single word "ok"' }],
          max_tokens: 5,
        })
        expect(resp.content.toLowerCase()).toContain('ok')
        expect(resp.usage.input_tokens).toBeGreaterThan(0)
        expect(resp.usage.output_tokens).toBeGreaterThan(0)
      },
      30_000,
    )
  },
)

describe.runIf(envOrSkip('POLYCODER_INT_TEST_QWEN_KEY') !== null)(
  'QwenProvider integration',
  () => {
    const apiKey = envOrSkip('POLYCODER_INT_TEST_QWEN_KEY')!
    it(
      'completes a 1-token request',
      async () => {
        const p = new QwenProvider({ apiKey })
        const resp = await p.chat({
          model: 'qwen-plus',
          messages: [{ role: 'user', content: 'reply with the single word "ok"' }],
          max_tokens: 5,
        })
        expect(resp.content.toLowerCase()).toContain('ok')
      },
      30_000,
    )
  },
)

describe.runIf(envOrSkip('POLYCODER_INT_TEST_GLM_KEY') !== null)(
  'GLMProvider integration',
  () => {
    const apiKey = envOrSkip('POLYCODER_INT_TEST_GLM_KEY')!
    it(
      'completes a 1-token request',
      async () => {
        const p = new GLMProvider({ apiKey })
        const resp = await p.chat({
          model: 'glm-4-flash',
          messages: [{ role: 'user', content: 'reply with the single word "ok"' }],
          max_tokens: 5,
        })
        expect(resp.content.toLowerCase()).toContain('ok')
      },
      30_000,
    )
  },
)

describe.runIf(envOrSkip('POLYCODER_INT_TEST_ANTHROPIC_KEY') !== null)(
  'AnthropicProvider integration',
  () => {
    const apiKey = envOrSkip('POLYCODER_INT_TEST_ANTHROPIC_KEY')!
    it(
      'completes a 1-token request',
      async () => {
        const p = new AnthropicProvider({ apiKey })
        const resp = await p.chat({
          model: 'claude-haiku-4-5-20251001',
          messages: [{ role: 'user', content: 'reply with the single word "ok"' }],
          max_tokens: 5,
        })
        expect(resp.content.toLowerCase()).toContain('ok')
      },
      30_000,
    )
  },
)

// A trivial test that always runs so vitest doesn't complain about an
// empty file when no integration env vars are set.
describe('integration scaffold metadata', () => {
  it('lists supported integration env vars', () => {
    const supported = [
      'POLYCODER_INT_TEST_DEEPSEEK_KEY',
      'POLYCODER_INT_TEST_QWEN_KEY',
      'POLYCODER_INT_TEST_GLM_KEY',
      'POLYCODER_INT_TEST_ANTHROPIC_KEY',
    ]
    for (const v of supported) {
      expect(typeof v).toBe('string')
    }
  })
})
