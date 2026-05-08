// AnthropicProvider — native /v1/messages API. Diverges from OpenAI:
//   * System prompt is a top-level field (not a 'system' role message)
//   * Tool schema uses { name, description, input_schema } directly
//     (not nested under function: {...})
//   * Streaming events include event:type lines (parsed by sseParser)
//   * Cache markers are explicit cache_control blocks
//   * Auth header is x-api-key, not Authorization: Bearer
//
// See docs/specs/providers.md §6.5.

import type { ProviderId } from '@core/types/workspace.js'
import type {
  ChatMessage,
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
import { ANTHROPIC_MODELS } from './modelCatalogs.js'

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com'
export const ANTHROPIC_API_VERSION = '2023-06-01'

export type AnthropicProviderOptions = {
  apiKey: string
  baseUrl?: string
  fetchImpl?: FetchImpl
  modelInfos?: ModelInfo[]
}

export class AnthropicProvider implements ModelProvider {
  readonly id: ProviderId = 'anthropic'
  readonly base_url: string
  protected readonly apiKey: string
  protected readonly fetchImpl: FetchImpl
  protected readonly modelInfos: ModelInfo[]

  constructor(opts: AnthropicProviderOptions) {
    this.apiKey = opts.apiKey
    this.base_url = (opts.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.modelInfos = opts.modelInfos ?? ANTHROPIC_MODELS
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.modelInfos
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const body = this.buildBody(request, false)
    const resp = await httpRequest({
      method: 'POST',
      url: `${this.base_url}/v1/messages`,
      headers: this.headers(),
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
      fetchImpl: this.fetchImpl,
    })

    if (resp.status !== 200) {
      throw await this.errorFromResponse(resp, request.model)
    }
    const json = (await resp.json()) as AnthropicMessageJson
    return this.responseFromJson(json, request.model)
  }

  async *stream(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const body = this.buildBody(request, true)
    const resp = await httpRequest({
      method: 'POST',
      url: `${this.base_url}/v1/messages`,
      headers: this.headers(),
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

    let assembledContent = ''
    let finishReason: FinishReason = 'stop'
    let inputTokens = 0
    let outputTokens = 0
    let cachedInputTokens = 0
    const toolCalls: ChatToolCall[] = []
    let responseId = ''
    // Track per-content-block state.
    const blocks = new Map<
      number,
      { type: 'text' | 'tool_use'; toolId?: string; toolName?: string; argText: string }
    >()

    for await (const sseEvent of parseSse(resp.body)) {
      if (!sseEvent.event) continue
      let data: AnthropicStreamData
      try {
        data = JSON.parse(sseEvent.data) as AnthropicStreamData
      } catch {
        continue
      }

      switch (sseEvent.event) {
        case 'message_start': {
          const ms = data as AnthropicMessageStart
          responseId = ms.message?.id ?? ''
          if (ms.message?.usage) {
            inputTokens = ms.message.usage.input_tokens ?? 0
            cachedInputTokens =
              (ms.message.usage.cache_read_input_tokens ?? 0) +
              (ms.message.usage.cache_creation_input_tokens ?? 0)
          }
          break
        }
        case 'content_block_start': {
          const cs = data as AnthropicContentBlockStart
          if (cs.content_block?.type === 'text') {
            blocks.set(cs.index, { type: 'text', argText: '' })
          } else if (cs.content_block?.type === 'tool_use') {
            blocks.set(cs.index, {
              type: 'tool_use',
              toolId: cs.content_block.id,
              toolName: cs.content_block.name,
              argText: '',
            })
            yield {
              type: 'tool_call_start',
              tool_call_id: cs.content_block.id,
              name: cs.content_block.name,
            }
          }
          break
        }
        case 'content_block_delta': {
          const cd = data as AnthropicContentBlockDelta
          const block = blocks.get(cd.index)
          if (!block) break
          if (cd.delta?.type === 'text_delta' && cd.delta.text) {
            assembledContent += cd.delta.text
            yield { type: 'content_delta', delta: cd.delta.text }
          } else if (cd.delta?.type === 'input_json_delta' && cd.delta.partial_json) {
            block.argText += cd.delta.partial_json
            if (block.toolId) {
              yield {
                type: 'tool_call_arguments_delta',
                tool_call_id: block.toolId,
                arguments_delta: cd.delta.partial_json,
              }
            }
          }
          break
        }
        case 'content_block_stop': {
          const cs = data as AnthropicContentBlockStop
          const block = blocks.get(cs.index)
          if (!block || block.type !== 'tool_use') break
          let parsed: Record<string, unknown> = {}
          try {
            parsed = block.argText
              ? (JSON.parse(block.argText) as Record<string, unknown>)
              : {}
          } catch {
            parsed = { __raw: block.argText }
          }
          if (block.toolId && block.toolName) {
            yield {
              type: 'tool_call_end',
              tool_call_id: block.toolId,
              full_arguments: parsed,
            }
            toolCalls.push({
              id: block.toolId,
              name: block.toolName,
              arguments: parsed,
            })
          }
          break
        }
        case 'message_delta': {
          const md = data as AnthropicMessageDelta
          if (md.delta?.stop_reason) {
            finishReason = mapStopReason(md.delta.stop_reason)
          }
          if (md.usage?.output_tokens !== undefined) {
            outputTokens = md.usage.output_tokens
          }
          break
        }
        case 'message_stop': {
          // Final marker; usage already captured.
          break
        }
        case 'error': {
          const err = data as AnthropicErrorPayload
          yield {
            type: 'error',
            error: {
              code: 'unknown',
              message: err.error?.message ?? 'Anthropic stream error',
              retryable: false,
            },
          }
          return
        }
        // ping: ignore
        default:
          break
      }
    }

    const usage = this.computeUsage(
      inputTokens,
      outputTokens,
      cachedInputTokens,
      request.model,
    )

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
    // Hit the messages endpoint with a 1-token request to validate auth.
    try {
      const resp = await httpRequest({
        method: 'POST',
        url: `${this.base_url}/v1/messages`,
        headers: this.headers(),
        body: JSON.stringify({
          model: this.modelInfos[0]?.id ?? 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        timeout_ms: 15_000,
        fetchImpl: this.fetchImpl,
      })
      if (resp.status === 200) {
        return { ok: true, available_models: this.modelInfos }
      }
      const text = await resp.text().catch(() => '')
      const reason: 'auth_failed' | 'network' | 'rate_limited' | 'unknown' =
        resp.status === 401 || resp.status === 403
          ? 'auth_failed'
          : resp.status === 429
            ? 'rate_limited'
            : 'unknown'
      return { ok: false, reason, detail: `HTTP ${resp.status}: ${text.slice(0, 300)}` }
    } catch (e) {
      return {
        ok: false,
        reason: 'network',
        detail: e instanceof Error ? e.message : String(e),
      }
    }
  }

  // ─── Internals ──────────────────────────────────────────────────

  protected headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'Content-Type': 'application/json',
    }
  }

  protected buildBody(request: ChatRequest, streaming: boolean): Record<string, unknown> {
    // Extract any 'system' role messages → top-level system field.
    const systemMessages: string[] = []
    const otherMessages: ChatMessage[] = []
    for (const m of request.messages) {
      if (m.role === 'system') {
        if (typeof m.content === 'string') {
          systemMessages.push(m.content)
        } else {
          systemMessages.push(
            m.content
              .filter((c) => c.type === 'text')
              .map((c) => (c.type === 'text' ? c.text : ''))
              .join(''),
          )
        }
      } else {
        otherMessages.push(m)
      }
    }
    const system = systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.max_tokens ?? 4096,
      messages: otherMessages.map((m) => this.translateMessage(m)),
      stream: streaming,
    }
    if (system !== undefined) body.system = system
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.top_p !== undefined) body.top_p = request.top_p
    if (request.stop) body.stop_sequences = request.stop
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }))
      if (request.tool_choice) {
        body.tool_choice =
          request.tool_choice === 'auto'
            ? { type: 'auto' }
            : request.tool_choice === 'none'
              ? { type: 'none' }
              : { type: 'tool', name: request.tool_choice.name }
      }
    }
    return body
  }

  protected translateMessage(m: ChatMessage): Record<string, unknown> {
    // Anthropic accepts 'user' and 'assistant'. Tool results come as
    // user-role messages with content blocks of type tool_result.
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id ?? '',
            content: typeof m.content === 'string' ? m.content : '',
          },
        ],
      }
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [
          ...(typeof m.content === 'string' && m.content
            ? [{ type: 'text', text: m.content }]
            : []),
          ...m.tool_calls.map((tc) => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        ],
      }
    }
    return {
      role: m.role,
      content: typeof m.content === 'string' ? m.content : flattenText(m.content),
    }
  }

  protected responseFromJson(json: AnthropicMessageJson, modelId: string): ChatResponse {
    let content = ''
    const toolCalls: ChatToolCall[] = []
    for (const block of json.content) {
      if (block.type === 'text') content += block.text
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input ?? {},
        })
      }
    }
    return {
      id: json.id,
      content,
      tool_calls: toolCalls,
      finish_reason: mapStopReason(json.stop_reason),
      usage: this.computeUsage(
        json.usage?.input_tokens ?? 0,
        json.usage?.output_tokens ?? 0,
        (json.usage?.cache_read_input_tokens ?? 0) +
          (json.usage?.cache_creation_input_tokens ?? 0),
        modelId,
      ),
      raw_response: json,
    }
  }

  protected computeUsage(
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens: number,
    modelId: string,
  ): TokenUsage {
    const info = this.modelInfos.find((m) => m.id === modelId)
    const inputCost =
      ((inputTokens - cachedInputTokens) *
        (info?.cost_per_million_input_tokens ?? 0)) /
      1_000_000
    const cachedCost =
      (cachedInputTokens *
        (info?.cost_per_million_cached_input_tokens ??
          info?.cost_per_million_input_tokens ??
          0)) /
      1_000_000
    const outputCost =
      (outputTokens * (info?.cost_per_million_output_tokens ?? 0)) / 1_000_000
    const cost = Math.round((inputCost + cachedCost + outputCost) * 10000) / 10000
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: cachedInputTokens,
      total_tokens: inputTokens + outputTokens,
      estimated_cost_usd: cost,
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

// ─── JSON shapes ────────────────────────────────────────────────────

type AnthropicUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

type AnthropicMessageJson = {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >
  stop_reason: string | null
  usage?: AnthropicUsage
}

type AnthropicStreamData = Record<string, unknown>

type AnthropicMessageStart = {
  message?: { id?: string; usage?: AnthropicUsage }
}

type AnthropicContentBlockStart = {
  index: number
  content_block?:
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
}

type AnthropicContentBlockDelta = {
  index: number
  delta?:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
}

type AnthropicContentBlockStop = { index: number }

type AnthropicMessageDelta = {
  delta?: { stop_reason?: string }
  usage?: { output_tokens?: number }
}

type AnthropicErrorPayload = {
  error?: { type?: string; message?: string }
}

function mapStopReason(r: string | null | undefined): FinishReason {
  switch (r) {
    case 'end_turn':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'stop_sequence':
      return 'stop'
    case 'tool_use':
      return 'tool_use'
    default:
      return 'stop'
  }
}

function flattenText(blocks: Array<{ type: string; text?: string }>): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}
