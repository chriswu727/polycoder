// DeepSeekProvider — OpenAI-compat with DeepSeek-specific defaults.
// See docs/specs/providers.md §6.1.

import type { ProviderId } from '@core/types/workspace.js'
import { OpenAICompatProvider } from './OpenAICompatProvider.js'
import type { FetchImpl } from './httpClient.js'
import type { ModelInfo } from './ModelProvider.js'
import { DEEPSEEK_MODELS } from './modelCatalogs.js'

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com'

export type DeepSeekProviderOptions = {
  apiKey: string
  baseUrl?: string
  fetchImpl?: FetchImpl
  /** Override the catalog (rare). */
  modelInfos?: ModelInfo[]
}

export class DeepSeekProvider extends OpenAICompatProvider {
  override readonly id: ProviderId = 'deepseek'

  constructor(opts: DeepSeekProviderOptions) {
    super({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      modelInfos: opts.modelInfos ?? DEEPSEEK_MODELS,
    })
  }

  override async listModels(): Promise<ModelInfo[]> {
    // DeepSeek's hardcoded catalog is authoritative; we don't trust the
    // /v1/models endpoint to return cost data.
    return this.modelInfos
  }
}
