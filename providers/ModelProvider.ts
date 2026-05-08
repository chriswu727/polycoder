// ModelProvider — the single abstraction sitting between polycoder's
// pipeline and any concrete LLM provider. See docs/specs/providers.md
// for the contract; ADR-003 for why we don't use LiteLLM.

import type { ProviderId } from '@core/types/workspace.js'

// ─── Capabilities & info ─────────────────────────────────────────────

export type ModelCapabilities = {
  supports_streaming: boolean
  supports_tool_use: boolean
  supports_vision: boolean
  supports_json_mode: boolean
  context_window: number
  max_output_tokens: number
}

export type ModelInfo = {
  id: string
  display_name: string
  capabilities: ModelCapabilities
  cost_per_million_input_tokens: number
  cost_per_million_output_tokens: number
  cost_per_million_cached_input_tokens?: number
}

// ─── Messages ────────────────────────────────────────────────────────

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; url: string }
  | { type: 'cache_marker'; position: 'before' | 'after' }

export type ChatToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type ChatMessage = {
  role: ChatRole
  content: string | ChatContentBlock[]
  tool_call_id?: string
  tool_calls?: ChatToolCall[]
}

// ─── Tool schemas (sent to the model) ────────────────────────────────

export type ToolSchema = {
  name: string
  description: string
  /** JSON Schema describing the tool's input. */
  input_schema: Record<string, unknown>
}

// ─── Request / response ──────────────────────────────────────────────

export type ChatRequest = {
  model: string
  messages: ChatMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string[]
  tools?: ToolSchema[]
  tool_choice?: 'auto' | 'none' | { name: string }
  response_format?: { type: 'json_object' } | { type: 'text' }
  stream?: boolean
  metadata?: { workspace_id?: string; iteration_id?: string; role?: string }
}

export type FinishReason = 'stop' | 'length' | 'tool_use' | 'content_filter' | 'error'

export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  total_tokens: number
  estimated_cost_usd: number
}

export type ChatResponse = {
  id: string
  content: string
  tool_calls: ChatToolCall[]
  finish_reason: FinishReason
  usage: TokenUsage
  raw_response: unknown
}

// ─── Streaming events ────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'content_delta'; delta: string }
  | { type: 'tool_call_start'; tool_call_id: string; name: string }
  | { type: 'tool_call_arguments_delta'; tool_call_id: string; arguments_delta: string }
  | { type: 'tool_call_end'; tool_call_id: string; full_arguments: Record<string, unknown> }
  | { type: 'message_complete'; response: ChatResponse }
  | { type: 'error'; error: ProviderErrorPayload }

/** A bag carried inside `error` events; full ProviderError class lives in errors.ts. */
export type ProviderErrorPayload = {
  code: ProviderErrorCode
  message: string
  retryable: boolean
  retry_after_ms?: number
}

// ─── Error taxonomy (defined here for cyclic-import freedom) ─────────

export type ProviderErrorCode =
  | 'auth_failed'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'context_too_long'
  | 'output_truncated'
  | 'content_filtered'
  | 'tool_call_invalid'
  | 'service_unavailable'
  | 'network'
  | 'invalid_request'
  | 'unknown'

// ─── Connection-test result ──────────────────────────────────────────

export type TestConnectionResult =
  | { ok: true; available_models: ModelInfo[] }
  | {
      ok: false
      reason: 'auth_failed' | 'network' | 'rate_limited' | 'unknown'
      detail: string
    }

// ─── The interface itself ────────────────────────────────────────────

export interface ModelProvider {
  readonly id: ProviderId
  readonly base_url: string

  listModels(): Promise<ModelInfo[]>
  chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>
  stream(request: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>
  testConnection(): Promise<TestConnectionResult>
}
