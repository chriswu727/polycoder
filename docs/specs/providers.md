# Provider Abstraction — Implementation Spec

> **Status**: Design contract. Implementation has not started.
> **Owner doc**: This file is the contract; if implementation deviates,
> update this file first.
> **Related**: ADR-003 (custom abstraction over LiteLLM),
> ADR-008 (tool framework — separate but parallel pattern)
> ADR-011 (verification independence — provider identity matters)

---

## 1. Why a custom abstraction

See ADR-003. Summary: LiteLLM lags Chinese providers, normalizes cost
and streaming inconsistently, and a homegrown layer is small (~300-500
LOC), is a tangible engineering artifact, and gives us full control of
the error taxonomy.

---

## 2. The ModelProvider interface

```typescript
// providers/ModelProvider.ts

export type ProviderId =
  | 'deepseek'
  | 'qwen'
  | 'glm'
  | 'openai-compat'
  | 'anthropic'

export type ModelCapabilities = {
  supports_streaming: boolean
  supports_tool_use: boolean
  supports_vision: boolean
  supports_json_mode: boolean
  context_window: number
  max_output_tokens: number
}

export type ModelInfo = {
  id: string                                  // provider-native, e.g. 'deepseek-chat'
  display_name: string                        // human label
  capabilities: ModelCapabilities
  cost_per_million_input_tokens: number       // USD
  cost_per_million_output_tokens: number      // USD
  cost_per_million_cached_input_tokens?: number  // some providers offer
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatContentBlock[]        // string for simple text, blocks for multimodal
  tool_call_id?: string
  tool_calls?: ChatToolCall[]
}

export type ChatContentBlock =
  | { type: 'text', text: string }
  | { type: 'image_url', url: string }
  | { type: 'cache_marker', position: 'before' | 'after' }  // for prompt caching

export type ChatToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>          // already JSON-parsed
}

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
  metadata?: { workspace_id?: string, iteration_id?: string, role?: string }
}

export type ChatResponse = {
  id: string                                  // provider-native response ID
  content: string                             // assembled assistant text
  tool_calls: ChatToolCall[]
  finish_reason: 'stop' | 'length' | 'tool_use' | 'content_filter' | 'error'
  usage: TokenUsage
  raw_response: unknown                       // the provider's original payload
}

export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  cached_input_tokens?: number                // 0 if provider doesn't expose
  total_tokens: number                        // computed: input + output
  estimated_cost_usd: number                  // computed using ModelInfo
}

export type StreamEvent =
  | { type: 'content_delta', delta: string }
  | { type: 'tool_call_start', tool_call_id: string, name: string }
  | { type: 'tool_call_arguments_delta', tool_call_id: string, arguments_delta: string }
  | { type: 'tool_call_end', tool_call_id: string, full_arguments: Record<string, unknown> }
  | { type: 'message_complete', response: ChatResponse }
  | { type: 'error', error: ProviderError }

export interface ModelProvider {
  readonly id: ProviderId
  readonly base_url_default: string

  /**
   * Lifecycle: instantiation. apiKey + baseUrl override come from a
   * stored Secret. The constructor itself is thin — no network calls.
   */
  // (Concrete classes implement constructor(apiKey: string, baseUrl?: string))

  /**
   * List models available on this account. Used to populate the
   * Model dropdown in the Team Configuration UI after user adds a
   * Secret. May be cached for 5 minutes per (provider, apiKey).
   */
  listModels(): Promise<ModelInfo[]>

  /**
   * Single non-streaming chat completion.
   */
  chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>

  /**
   * Streaming chat completion. Yields StreamEvents as they arrive.
   * Always ends with a 'message_complete' OR 'error' event.
   */
  stream(request: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>

  /**
   * Validate that the API key is well-formed and authenticates against
   * this provider. Should hit the cheapest possible endpoint (e.g. list
   * models). Returns success/failure + diagnostic.
   */
  testConnection(): Promise<TestConnectionResult>
}

export type TestConnectionResult =
  | { ok: true, available_models: ModelInfo[] }
  | { ok: false, reason: 'auth_failed' | 'network' | 'rate_limited' | 'unknown', detail: string }
```

---

## 3. Error taxonomy

All providers map their native errors into a uniform set:

```typescript
export type ProviderErrorCode =
  | 'auth_failed'              // 401, 403 — bad key
  | 'rate_limited'             // 429 — back off
  | 'quota_exceeded'           // billing / usage cap hit
  | 'context_too_long'         // input exceeds context window
  | 'output_truncated'         // hit max_tokens before stop reason
  | 'content_filtered'         // provider-side content policy
  | 'tool_call_invalid'        // tool name / args rejected
  | 'service_unavailable'      // 5xx, transient
  | 'network'                  // timeout, DNS, connection
  | 'invalid_request'          // 400 — malformed
  | 'unknown'

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly providerId: ProviderId,
    readonly modelId: string,
    readonly message: string,
    readonly retryable: boolean,
    readonly retry_after_ms?: number,         // populated if rate_limited
    readonly raw_error?: unknown
  ) { super(message) }
}
```

The orchestrator's retry policy keys off `retryable`:
- `rate_limited` + `retry_after_ms`: wait then retry, up to 3 attempts
- `service_unavailable`: exponential backoff, up to 3 attempts
- `network`: retry once with shorter timeout
- everything else: no automatic retry; surface to user

---

## 4. Streaming protocol

All providers' stream events normalize to the `StreamEvent` union
above. Implementation notes for each:

- **Content deltas**: every newly arrived assistant text chunk.
  Concatenate to assemble the full message.
- **Tool calls**: many providers stream tool-call arguments as JSON
  text deltas (e.g. `{"path": "src/`, then `index.ts"}`). The
  adapter buffers and emits `tool_call_arguments_delta` per chunk,
  finally emitting `tool_call_end` with parsed arguments.
- **End-of-stream**: always emit `message_complete` with the fully
  assembled `ChatResponse` (including final usage/cost). Even on
  errors mid-stream, emit one terminal `error` event.

The adapter is responsible for handling provider-specific quirks
(SSE formatting, multipart, polling, etc.) and presenting a clean
async iterable to upstream.

---

## 5. Cost tracking

Every adapter populates `usage` with input/output/total tokens. The
adapter computes `estimated_cost_usd`:

```typescript
function estimateCost(usage: TokenUsage, model: ModelInfo): number {
  return (
    (usage.input_tokens - (usage.cached_input_tokens ?? 0)) *
      (model.cost_per_million_input_tokens / 1_000_000) +
    (usage.cached_input_tokens ?? 0) *
      ((model.cost_per_million_cached_input_tokens ?? model.cost_per_million_input_tokens) / 1_000_000) +
    usage.output_tokens *
      (model.cost_per_million_output_tokens / 1_000_000)
  )
}
```

Costs are rounded to 4 decimal places (`Math.round(x * 10000) / 10000`)
for storage; UI displays 2-3 decimal places.

The orchestrator aggregates per-iteration and per-workspace totals
into a separate `cost_tracker` (see `orchestrator.md`).

---

## 6. Per-adapter specs

### 6.1 DeepSeekProvider

- **Base URL**: `https://api.deepseek.com`
- **Auth**: `Authorization: Bearer ${apiKey}`
- **API style**: OpenAI-compatible (`/v1/chat/completions`)
- **Models** (V0):
  - `deepseek-chat` (V3.x) — general
  - `deepseek-coder` (V3.x) — code-specialized
  - `deepseek-reasoner` — DeepSeek-R1 family (reasoning)
- **Streaming**: SSE, OpenAI-format
- **Cost tracking**: provider returns `usage` with
  `prompt_cache_hit_tokens` (treat as `cached_input_tokens`).
- **Quirks**:
  - Reasoning models stream `reasoning_content` separately from
    `content`. V0 ignores reasoning_content (don't surface to roles
    that don't request it). V1+ may pass through to specific roles.
  - JSON mode (`response_format: { type: 'json_object' }`) supported.
  - Tool use supported on `deepseek-chat` and `deepseek-reasoner`,
    NOT `deepseek-coder` (per docs as of Apr 2026 — verify before V0).
- **Implementation file**: `providers/DeepSeekProvider.ts`

### 6.2 QwenProvider (Alibaba 通义)

- **Base URL**: `https://dashscope.aliyuncs.com/compatible-mode`
  (the OpenAI-compat endpoint; the native `dashscope` endpoint at
  `https://dashscope.aliyuncs.com/api/v1` has a different schema and
  is **not** what we use)
- **Auth**: `Authorization: Bearer ${apiKey}`
- **API style**: OpenAI-compatible at the compat endpoint
- **Models** (V0):
  - `qwen-max` — flagship reasoning
  - `qwen-plus` — balanced cost/quality
  - `qwen-turbo` — cheapest
  - `qwen3-coder` — code-specialized
  - `qwen-vl-max` — multimodal (Designer role, when image refs given)
- **Streaming**: SSE
- **Cost tracking**: usage in OpenAI shape
- **Quirks**:
  - Some models require `enable_search: false` to avoid auto web
    search. Default to false unless explicitly requested.
  - Vision models accept image URLs but recommend base64-inline for
    private images.
  - Rate limits are stricter than the public docs suggest in
    practice; expect occasional 429 even at low QPS during peak hours.
- **Implementation file**: `providers/QwenProvider.ts`

### 6.3 GLMProvider (智谱 Zhipu)

- **Base URL**: `https://open.bigmodel.cn/api/paas/v4`
- **Auth**: `Authorization: Bearer ${apiKey}` (note: GLM keys are
  longer than typical; ~80 chars)
- **API style**: OpenAI-compatible
- **Models** (V0):
  - `glm-4-plus` — flagship
  - `glm-4` — standard
  - `glm-4-flash` — cheapest, free tier eligible
  - `glm-4v` — vision (Designer role)
- **Streaming**: SSE
- **Cost tracking**: standard usage; free tier returns 0 cost
- **Quirks**:
  - Free tier (`glm-4-flash`) has aggressive rate limits — handle
    429 with explicit backoff
  - `tool_choice: 'auto'` sometimes returns plain text even when
    tool would be expected; adapter should handle gracefully (the
    role harness re-prompts if a tool call was required and didn't
    arrive — see `orchestrator.md`)
- **Implementation file**: `providers/GLMProvider.ts`

### 6.4 OpenAICompatProvider

A generic adapter for any OpenAI-API-compatible endpoint not covered
by a dedicated adapter. Useful for:

- Self-hosted vLLM / TGI / Ollama
- Enterprise proxies (e.g. company's Azure OpenAI deployment)
- Smaller providers (Together, Fireworks, Groq, etc.)

- **Base URL**: user-provided (`base_url` from Secret)
- **Auth**: `Authorization: Bearer ${apiKey}` (user can leave key
  empty for unauth'd self-hosted)
- **Models**: user-provided list (no `listModels()` reliability —
  the user enters model IDs manually in Team Configuration; adapter
  just relays them)
- **Streaming**: SSE
- **Cost tracking**: cost data is unknown for arbitrary endpoints.
  Adapter returns `estimated_cost_usd: 0` and the UI shows "(self-hosted —
  cost unknown)". Workspaces using this provider can't show
  meaningful per-iteration cost.
- **Quirks**: caller-beware. We document that not every
  "OpenAI-compatible" endpoint is fully compatible (some lack
  streaming, tool use, or proper usage reporting).
- **Implementation file**: `providers/OpenAICompatProvider.ts`

### 6.5 AnthropicProvider

- **Base URL**: `https://api.anthropic.com`
- **Auth**: `x-api-key: ${apiKey}` + `anthropic-version: 2023-06-01`
- **API style**: Anthropic-native (`/v1/messages`)
- **Models** (V0):
  - `claude-opus-4-7-20260101` (and friends — pull dynamically)
  - `claude-sonnet-4-6-20251022`
  - `claude-haiku-4-5-20251001`
  - (model IDs may shift; use `listModels()` against
    `https://api.anthropic.com/v1/models` to populate dropdowns)
- **Streaming**: native event stream (`data: {...}\n\n`)
- **Cost tracking**: usage block includes
  `cache_creation_input_tokens` and `cache_read_input_tokens`.
  Treat `cache_read_input_tokens` as `cached_input_tokens`.
- **Quirks**:
  - System prompt is a separate top-level field, not a role-system
    message. Adapter pulls it out of `messages[].role === 'system'`
    and places it correctly.
  - Tool use schema differs from OpenAI's `tools` array — adapter
    converts. (Schema: `{ name, description, input_schema }`,
    not `{ type: 'function', function: { name, description, parameters } }`).
  - Cache markers are explicit (`cache_control: { type: 'ephemeral' }`)
    placed on content blocks. Adapter inserts these at the
    `___POLYCODER_PROMPT_BOUNDARY___` location to preserve cache
    across role calls.
  - China availability: most Chinese users CANNOT directly reach
    api.anthropic.com. Adapter respects `base_url` override so users
    can configure a proxy (Cloudflare Worker, custom relay). When
    direct access fails, error code is `network` not `auth_failed`.
- **Implementation file**: `providers/AnthropicProvider.ts`

---

## 7. Registry and instantiation

```typescript
// providers/registry.ts

const PROVIDER_FACTORIES: Record<ProviderId, (apiKey: string, baseUrl?: string) => ModelProvider> = {
  deepseek: (k, b) => new DeepSeekProvider(k, b),
  qwen: (k, b) => new QwenProvider(k, b),
  glm: (k, b) => new GLMProvider(k, b),
  'openai-compat': (k, b) => new OpenAICompatProvider(k, b ?? throw_required('base_url')),
  anthropic: (k, b) => new AnthropicProvider(k, b),
}

export function buildProvider(secret: Secret): ModelProvider {
  const factory = PROVIDER_FACTORIES[secret.provider]
  if (!factory) throw new Error(`Unknown provider: ${secret.provider}`)
  return factory(secret.api_key, secret.base_url)
}
```

The orchestrator gets a provider instance per role per iteration via
this registry, using the workspace's RoleAssignment → Secret →
Provider chain.

**Caching**: Provider instances are stateless aside from the apiKey/
baseUrl. We can memoize per (provider_id, api_key, base_url) tuple
during a single workspace session — but **must invalidate on Secret
edit**. Simplest implementation: re-instantiate per pipeline run; the
overhead is negligible.

---

## 8. Cache markers (Anthropic-specific, V0)

To make ADR-009's prompt-cache-boundary work end-to-end:

1. The role harness assembles the system prompt with the literal
   string `___POLYCODER_PROMPT_BOUNDARY___` separating static and
   dynamic sections.
2. The provider adapter, on receiving a request, scans the system
   prompt for the marker.
3. For Anthropic: the adapter splits the system prompt into two
   `system` content blocks, with a `cache_control: { type:
   'ephemeral' }` on the first block.
4. For other providers (DeepSeek/Qwen/GLM/OpenAI-compat): the
   marker is stripped before sending; cache boundary is implicit
   (these providers cache automatically based on prefix matching).

This means adapters need a small `prepareSystemPrompt(s: string):
ProviderSystemBlocks` helper that handles boundary semantics
provider-natively.

---

## 9. Testing

Each provider adapter should ship with:

- **Unit test** for streaming protocol parsing (mock SSE → expected
  StreamEvents)
- **Unit test** for error mapping (mock provider errors → expected
  ProviderErrorCodes)
- **Integration test** (gated by env var with a real test key) hitting
  `listModels()` + `chat()` with a 1-token request

Provider tests run as part of CI but the integration tests are
opt-in (need keys configured in CI secrets — V0 may skip and rely
on local-dev validation).

---

## 10. Open questions

1. **Should `listModels()` be cached, and for how long?** First cut:
   5-minute TTL per (provider, key) tuple, in-memory. Bump if user
   complains about new models not appearing.

2. **Retry policy for `network` errors during streaming**: should
   we restart from the beginning, or attempt to resume? V0: restart.
   Streaming resumption requires server-side support most providers
   don't offer.

3. **Tool use for non-tool-supporting models**: if the user assigns
   a non-tool-supporting model to a role that needs tools (e.g. Test
   Runner needs `bash`), what happens? V0: the orchestrator detects
   this at workspace-load time and shows a red warning in Team
   Configuration ("Test Runner role requires tools, but
   `deepseek-coder` doesn't support tool use — pick another model").

4. **JSON mode reliability**: not all providers support
   `response_format: { type: 'json_object' }` cleanly. V0 falls
   back to prompt-engineered JSON ("respond with a single valid JSON
   object — no prose") + adapter-side validation + re-prompt on
   parse failure.

5. **Multi-modal support timing**: the Designer role optionally takes
   image references. V0 supports this only if the user assigns a
   vision-capable model (Qwen-VL-Max, GLM-4V, Claude Sonnet, GPT-4V).
   Otherwise Designer's image-input feature is disabled and the role
   prompt reflects this.

---

## 11. Implementation order

When implementation starts (see `todo.md`), build in this order:

1. **ModelProvider interface + types** (1 file, no impl)
2. **OpenAICompatProvider** (the simplest, most generic — many
   later adapters share its logic via composition)
3. **DeepSeekProvider** (closest to OpenAI shape, fewest quirks)
4. **QwenProvider** (similar shape, more quirks)
5. **GLMProvider** (similar shape, free-tier constraints)
6. **AnthropicProvider** (most divergent — separate path for
   system prompt, cache markers, tool schema)
7. **registry.ts**
8. **prepareSystemPrompt helper** (shared across adapters)
9. **Tests** (parallel with each adapter)

Estimated total: ~1500 LOC across 7 source files + ~1500 LOC of
tests.
