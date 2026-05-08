// GLMProvider — Zhipu open.bigmodel.cn OpenAI-compat endpoint.
// See docs/specs/providers.md §6.3.

import type { ProviderId } from '@core/types/workspace.js'
import { OpenAICompatProvider } from './OpenAICompatProvider.js'
import type { FetchImpl } from './httpClient.js'
import type { ModelInfo } from './ModelProvider.js'
import { GLM_MODELS } from './modelCatalogs.js'

export const GLM_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

export type GLMProviderOptions = {
  apiKey: string
  baseUrl?: string
  fetchImpl?: FetchImpl
  modelInfos?: ModelInfo[]
}

export class GLMProvider extends OpenAICompatProvider {
  override readonly id: ProviderId = 'glm'

  constructor(opts: GLMProviderOptions) {
    super({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? GLM_DEFAULT_BASE_URL,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      modelInfos: opts.modelInfos ?? GLM_MODELS,
    })
  }

  override async listModels(): Promise<ModelInfo[]> {
    return this.modelInfos
  }
}
