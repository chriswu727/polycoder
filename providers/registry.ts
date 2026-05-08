// Provider registry — Secret → ModelProvider factory.
// See docs/specs/providers.md §7.

import type { HydratedSecret } from '@core/types/workspace.js'
import type { FetchImpl } from './httpClient.js'
import type { ModelProvider } from './ModelProvider.js'
import { OpenAICompatProvider } from './OpenAICompatProvider.js'
import { DeepSeekProvider } from './DeepSeekProvider.js'
import { QwenProvider } from './QwenProvider.js'
import { GLMProvider } from './GLMProvider.js'
import { AnthropicProvider } from './AnthropicProvider.js'

export type BuildProviderOptions = {
  /** Test-time fetch override. */
  fetchImpl?: FetchImpl
}

/**
 * Construct a ModelProvider from a hydrated Secret (metadata + key).
 * Throws if provider id is unknown, or if openai-compat is missing
 * its required base_url.
 */
export function buildProvider(
  secret: HydratedSecret,
  opts: BuildProviderOptions = {},
): ModelProvider {
  switch (secret.provider) {
    case 'deepseek':
      return new DeepSeekProvider({
        apiKey: secret.api_key,
        ...(secret.base_url !== null ? { baseUrl: secret.base_url } : {}),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      })
    case 'qwen':
      return new QwenProvider({
        apiKey: secret.api_key,
        ...(secret.base_url !== null ? { baseUrl: secret.base_url } : {}),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      })
    case 'glm':
      return new GLMProvider({
        apiKey: secret.api_key,
        ...(secret.base_url !== null ? { baseUrl: secret.base_url } : {}),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      })
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: secret.api_key,
        ...(secret.base_url !== null ? { baseUrl: secret.base_url } : {}),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      })
    case 'openai-compat': {
      if (!secret.base_url) {
        throw new Error(
          `Provider "openai-compat" requires base_url; secret "${secret.name}" has none configured.`,
        )
      }
      return new OpenAICompatProvider({
        apiKey: secret.api_key,
        baseUrl: secret.base_url,
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      })
    }
    default: {
      // Exhaustiveness check: unknown provider id at runtime
      const _never: never = secret.provider
      throw new Error(`Unknown provider id: ${String(_never)}`)
    }
  }
}
