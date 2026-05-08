// QwenProvider — Alibaba DashScope OpenAI-compat endpoint.
// See docs/specs/providers.md §6.2.

import type { ProviderId } from '@core/types/workspace.js'
import { OpenAICompatProvider } from './OpenAICompatProvider.js'
import type { FetchImpl } from './httpClient.js'
import type { ChatRequest, ModelInfo } from './ModelProvider.js'
import { QWEN_MODELS } from './modelCatalogs.js'

export const QWEN_DEFAULT_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode'

export type QwenProviderOptions = {
  apiKey: string
  baseUrl?: string
  fetchImpl?: FetchImpl
  modelInfos?: ModelInfo[]
}

export class QwenProvider extends OpenAICompatProvider {
  override readonly id: ProviderId = 'qwen'

  constructor(opts: QwenProviderOptions) {
    super({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? QWEN_DEFAULT_BASE_URL,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      modelInfos: opts.modelInfos ?? QWEN_MODELS,
    })
  }

  override async listModels(): Promise<ModelInfo[]> {
    return this.modelInfos
  }

  /**
   * Qwen-specific: explicitly disable enable_search to prevent
   * server-side automatic web search injection. See providers.md §6.2.
   */
  protected override buildRequestBody(
    request: ChatRequest,
    streaming: boolean,
  ): Record<string, unknown> {
    const body = super.buildRequestBody(request, streaming)
    body.enable_search = false
    return body
  }
}
