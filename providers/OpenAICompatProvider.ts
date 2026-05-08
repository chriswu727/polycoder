// OpenAI-compatible provider. Hits /v1/chat/completions with the
// standard OpenAI shape. Used directly for self-hosted endpoints
// (vLLM, TGI, Ollama, Together, Fireworks, Groq, etc.) AND as the
// base class for DeepSeek / Qwen / GLM (which all expose
// OpenAI-compat endpoints with provider-specific defaults).
//
// See docs/specs/providers.md §6.4.

import type { ProviderId } from '@core/types/workspace.js'
import type {
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  FinishReason,
  ModelInfo,
  ModelProvider,
  StreamEvent,
  TestConnectionResult,
  TokenUsage,
} from './ModelProvider.js'
import { ProviderError, classifyHttpStatus } from './errors.js'
import { httpRequest, type FetchImpl } from './httpClient.js'
import { parseSse } from './sseParser.js'

export type OpenAICompatProviderOptions = {
  apiKey: string
  baseUrl: string
  /** For tests; defaults to globalThis.fetch. */
  fetchImpl?: FetchImpl
  /**
   * Model registry — provider-specific cost / capability metadata used
   * by listModels() and cost estimation. If empty, listModels() returns
   * an empty array (caller should populate models manually in that case).
   */
  modelInfos?: ModelInfo[]
  /** Pricing fallback when a model isn't in modelInfos. Defaults to zero. */
  defaultModelInfo?: ModelInfo
}

export class OpenAICompatProvider implements ModelProvider {
  readonly id: ProviderId = 'openai-compat'
  readonly base_url: string
  protected readonly apiKey: string
  protected readonly fetchImpl: FetchImpl
  protected readonly modelInfos: ModelInfo[]
  protected readonly defaultModelInfo: ModelInfo | undefined

  constructor(opts: OpenAICompatProviderOptions) {
    this.apiKey = opts.apiKey
    this.base_url = opts.baseUrl.replace(/\/+$/, '') // trim trailing slashes
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.modelInfos = opts.modelInfos ?? []
    this.defaultModelInfo = opts.defaultModelInfo
  }

  async listModels(): Promise<ModelInfo[]> {
    // Subclasses with known model lists return that list directly without
    // hitting the network. Generic OpenAI-compat impl tries the standard
    // /v1/models endpoint but falls back to whatever was provided.
    if (this.modelInfos.length > 0) return this.modelInfos
    try {
      const resp = await httpRequest({
        method: 'GET',
        url: `${this.base_url}/v1/models`,
        headers: this.authHeaders(),
        fetchImpl: this.fetchImpl,
      })
      if (resp.status !== 200) return []
      const json = (await resp.json()) as { data?: Array<{ id: string }> }
      const ids = json.data?.map((m) => m.id) ?? []
      return ids.map((id) => this.synthesizeModelInfo(id))
    } catch {
      return []
    }
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const body = this.buildRequestBody(request, false)
    const resp = await httpRequest({
      method: 'POST',
      url: `${this.base_url}/v1/chat/completions`,
      headers: this.authHeaders(true),
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
      fetchImpl: this.fetchImpl,
    })

    if (resp.status !== 200) {
      throw await this.errorFromResponse(resp, request.model)
    }

    const json = (await resp.json()) as OpenAIChatJson
    return this.responseFromJson(json, request.model)
  }

  async *stream(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const body = this.buildRequestBody(request, true)
    const resp = await httpRequest({
      method: 'POST',
      url: `${this.base_url}/v1/chat/completions`,
      headers: this.authHeaders(true),
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
      fetchImpl: this.fetchImpl,
    })

    if (resp.status !== 200) {
      const err = await this.errorFromResponse(resp, request.model)
      yield {
        type: 'error',
        error: {
          code: err.code,
          message: err.message,
          retryable: err.retryable,
          ...(err.retry_after_ms !== undefined
            ? { retry_after_ms: err.retry_after_ms }
            : {}),
        },
      }
      return
    }

    if (!resp.body) {
      yield {
        type: 'error',
        error: {
          code: 'unknown',
          message: 'Empty response body for streaming request',
          retryable: false,
        },
      }
      return
    }

    // Track tool-call assembly across deltas.
    const toolCallBuffers = new Map<
      number,
      { id: string; name: string; argText: string; emittedStart: boolean }
    >()
    let assembledContent = ''
    let finishReason: FinishReason = 'stop'
    let usage: TokenUsage | undefined
    let responseId = ''

    for await (const sseEvent of parseSse(resp.body)) {
      const data = sseEvent.data
      if (data === '[DONE]') break
      if (!data) continue

      let parsed: OpenAIStreamJson
      try {
        parsed = JSON.parse(data) as OpenAIStreamJson
      } catch {
        continue // Skip malformed deltas; logged in production.
      }

      if (parsed.id) responseId = parsed.id
      if (parsed.usage) {
        usage = this.usageFromJson(parsed.usage, request.model)
      }

      const choice = parsed.choices?.[0]
      if (!choice) continue

      if (choice.finish_reason) {
        finishReason = mapFinishReason(choice.finish_reason)
      }

      const delta = choice.delta
      if (!delta) continue

      if (delta.content) {
        assembledContent += delta.content
        yield { type: 'content_delta', delta: delta.content }
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          let buf = toolCallBuffers.get(idx)
          if (!buf) {
            buf = {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              argText: '',
              emittedStart: false,
            }
            toolCallBuffers.set(idx, buf)
          }
          if (tc.id && !buf.id) buf.id = tc.id
          if (tc.function?.name && !buf.name) buf.name = tc.function.name

          if (!buf.emittedStart && buf.id && buf.name) {
            buf.emittedStart = true
            yield { type: 'tool_call_start', tool_call_id: buf.id, name: buf.name }
          }

          const argDelta = tc.function?.arguments ?? ''
          if (argDelta) {
            buf.argText += argDelta
            if (buf.emittedStart) {
              yield {
                type: 'tool_call_arguments_delta',
                tool_call_id: buf.id,
                arguments_delta: argDelta,
              }
            }
          }
        }
      }
    }

    // Finalize tool calls.
    const toolCalls: ChatToolCall[] = []
    for (const buf of toolCallBuffers.values()) {
      if (!buf.id || !buf.name) continue
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = buf.argText ? (JSON.parse(buf.argText) as Record<string, unknown>) : {}
      } catch {
        // Malformed JSON in tool arguments — surface as empty + raw text in response.
        parsedArgs = { __raw: buf.argText }
      }
      yield {
        type: 'tool_call_end',
        tool_call_id: buf.id,
        full_arguments: parsedArgs,
      }
      toolCalls.push({ id: buf.id, name: buf.name, arguments: parsedArgs })
    }

    if (!usage) {
      // Estimate when provider didn't include usage in the stream.
      usage = {
        input_tokens: 0,
        output_tokens: assembledContent.length / 4,
        cached_input_tokens: 0,
        total_tokens: assembledContent.length / 4,
        estimated_cost_usd: 0,
      }
    }

    const finalResponse: ChatResponse = {
      id: responseId || crypto.randomUUID(),
      content: assembledContent,
      tool_calls: toolCalls,
      finish_reason: finishReason,
      usage,
      raw_response: undefined,
    }

    yield { type: 'message_complete', response: finalResponse }
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const models = await this.listModels()
      return { ok: true, available_models: models }
    } catch (e) {
      if (e instanceof ProviderError) {
        const reason: 'auth_failed' | 'network' | 'rate_limited' | 'unknown' =
          e.code === 'auth_failed' ||
          e.code === 'rate_limited' ||
          e.code === 'network'
            ? e.code
            : 'unknown'
        return { ok: false, reason, detail: e.message }
      }
      return {
        ok: false,
        reason: 'unknown',
        detail: e instanceof Error ? e.message : String(e),
      }
    }
  }

  // ─── Internals ──────────────────────────────────────────────────

  protected authHeaders(forJson = false): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    }
    if (forJson) h['Content-Type'] = 'application/json'
    return h
  }

  protected buildRequestBody(
    request: ChatRequest,
    streaming: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : flattenContent(m.content),
        ...(m.tool_call_id !== undefined ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls
          ? {
              tool_calls: m.tool_calls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
      })),
      stream: streaming,
    }
    if (streaming) {
      body.stream_options = { include_usage: true }
    }
    if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.top_p !== undefined) body.top_p = request.top_p
    if (request.stop) body.stop = request.stop
    if (request.response_format) body.response_format = request.response_format
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }))
      if (request.tool_choice) {
        body.tool_choice =
          typeof request.tool_choice === 'string'
            ? request.tool_choice
            : { type: 'function', function: { name: request.tool_choice.name } }
      }
    }
    return body
  }

  protected responseFromJson(json: OpenAIChatJson, modelId: string): ChatResponse {
    const choice = json.choices[0]
    if (!choice) {
      throw new ProviderError(
        'invalid_request',
        this.id,
        modelId,
        'No choices in response',
        false,
      )
    }
    const toolCalls: ChatToolCall[] =
      choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: parseToolArgs(tc.function.arguments),
      })) ?? []

    return {
      id: json.id,
      content: choice.message.content ?? '',
      tool_calls: toolCalls,
      finish_reason: mapFinishReason(choice.finish_reason),
      usage: this.usageFromJson(json.usage ?? { prompt_tokens: 0, completion_tokens: 0 }, modelId),
      raw_response: json,
    }
  }

  protected usageFromJson(
    u: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number },
    modelId: string,
  ): TokenUsage {
    const cached = u.prompt_cache_hit_tokens ?? 0
    const input = u.prompt_tokens
    const output = u.completion_tokens
    const info = this.findModelInfo(modelId)
    const inputCost =
      ((input - cached) * (info?.cost_per_million_input_tokens ?? 0)) / 1_000_000
    const cachedCost =
      (cached *
        (info?.cost_per_million_cached_input_tokens ??
          info?.cost_per_million_input_tokens ??
          0)) /
      1_000_000
    const outputCost = (output * (info?.cost_per_million_output_tokens ?? 0)) / 1_000_000
    const cost = roundCost(inputCost + cachedCost + outputCost)

    return {
      input_tokens: input,
      output_tokens: output,
      cached_input_tokens: cached,
      total_tokens: input + output,
      estimated_cost_usd: cost,
    }
  }

  protected findModelInfo(modelId: string): ModelInfo | undefined {
    return this.modelInfos.find((m) => m.id === modelId) ?? this.defaultModelInfo
  }

  protected synthesizeModelInfo(id: string): ModelInfo {
    return {
      id,
      display_name: id,
      capabilities: {
        supports_streaming: true,
        supports_tool_use: false,
        supports_vision: false,
        supports_json_mode: false,
        context_window: 8192,
        max_output_tokens: 4096,
      },
      cost_per_million_input_tokens: 0,
      cost_per_million_output_tokens: 0,
    }
  }

  protected async errorFromResponse(
    resp: { status: number; headers: Headers; text: () => Promise<string> },
    modelId: string,
  ): Promise<ProviderError> {
    const text = await resp.text().catch(() => '')
    const { code, retryable } = classifyHttpStatus(resp.status)
    let retry_after_ms: number | undefined
    const retryAfter = resp.headers.get('retry-after')
    if (retryAfter) {
      const n = Number(retryAfter)
      if (!Number.isNaN(n)) retry_after_ms = n * 1000
    }
    return new ProviderError(
      code,
      this.id,
      modelId,
      `HTTP ${resp.status}: ${text.slice(0, 500)}`,
      retryable,
      retry_after_ms,
      { status: resp.status, body: text },
    )
  }
}

// ─── Module-private helpers ─────────────────────────────────────────

type OpenAIChatJson = {
  id: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    prompt_cache_hit_tokens?: number
  }
}

type OpenAIStreamJson = {
  id?: string
  choices?: Array<{
    index: number
    delta?: {
      content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    prompt_cache_hit_tokens?: number
  }
}

function mapFinishReason(r: string | null | undefined): FinishReason {
  switch (r) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'tool_calls':
      return 'tool_use'
    case 'content_filter':
      return 'content_filter'
    default:
      return 'stop'
  }
}

function parseToolArgs(s: string): Record<string, unknown> {
  if (!s) return {}
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return { __raw: s }
  }
}

function flattenContent(blocks: Array<{ type: string; text?: string; url?: string }>): string {
  // OpenAI chat content is either a string or an array of content blocks.
  // For now we serialize multi-block content as joined text — multimodal
  // (image_url) is provider-specific and handled in subclasses where
  // needed. cache_marker blocks are stripped here (they're consumed by
  // prepareSystemPrompt before reaching here).
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}

function roundCost(x: number): number {
  return Math.round(x * 10000) / 10000
}
