// Hardcoded model catalogs for the four V0 China-friendly providers.
// Costs are per-million tokens, USD. Verify against provider pricing
// pages before each release; quoted rates here are as of 2026-05.
//
// These are NOT a substitute for `listModels()` against the live API
// — they're the fallback when the user adds a Secret without testing
// the connection yet, and provide cost data the API doesn't return.

import type { ModelInfo } from './ModelProvider.js'

const STD_CAPS = {
  supports_streaming: true,
  supports_tool_use: true,
  supports_vision: false,
  supports_json_mode: true,
  context_window: 32768,
  max_output_tokens: 8192,
}

const VISION_CAPS = { ...STD_CAPS, supports_vision: true }
const NO_TOOLS_CAPS = { ...STD_CAPS, supports_tool_use: false }

// ─── DeepSeek ────────────────────────────────────────────────────────

export const DEEPSEEK_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-chat',
    display_name: 'DeepSeek-V3 (Chat)',
    capabilities: { ...STD_CAPS, context_window: 65536 },
    cost_per_million_input_tokens: 0.27,
    cost_per_million_output_tokens: 1.1,
    cost_per_million_cached_input_tokens: 0.07,
  },
  {
    id: 'deepseek-coder',
    display_name: 'DeepSeek Coder V3',
    capabilities: { ...NO_TOOLS_CAPS, context_window: 65536 },
    cost_per_million_input_tokens: 0.27,
    cost_per_million_output_tokens: 1.1,
    cost_per_million_cached_input_tokens: 0.07,
  },
  {
    id: 'deepseek-reasoner',
    display_name: 'DeepSeek-R1',
    capabilities: { ...STD_CAPS, context_window: 65536 },
    cost_per_million_input_tokens: 0.55,
    cost_per_million_output_tokens: 2.19,
    cost_per_million_cached_input_tokens: 0.14,
  },
]

// ─── Qwen (DashScope OpenAI-compat endpoint) ────────────────────────

export const QWEN_MODELS: ModelInfo[] = [
  {
    id: 'qwen-max',
    display_name: 'Qwen Max',
    capabilities: { ...STD_CAPS, context_window: 32768 },
    cost_per_million_input_tokens: 2.8,
    cost_per_million_output_tokens: 8.4,
  },
  {
    id: 'qwen-plus',
    display_name: 'Qwen Plus',
    capabilities: { ...STD_CAPS, context_window: 32768 },
    cost_per_million_input_tokens: 0.4,
    cost_per_million_output_tokens: 1.2,
  },
  {
    id: 'qwen-turbo',
    display_name: 'Qwen Turbo',
    capabilities: { ...STD_CAPS, context_window: 8192 },
    cost_per_million_input_tokens: 0.05,
    cost_per_million_output_tokens: 0.2,
  },
  {
    id: 'qwen3-coder',
    display_name: 'Qwen3 Coder',
    capabilities: { ...STD_CAPS, context_window: 65536 },
    cost_per_million_input_tokens: 0.4,
    cost_per_million_output_tokens: 1.2,
  },
  {
    id: 'qwen-vl-max',
    display_name: 'Qwen-VL Max (vision)',
    capabilities: { ...VISION_CAPS, context_window: 32768 },
    cost_per_million_input_tokens: 2.8,
    cost_per_million_output_tokens: 8.4,
  },
]

// ─── GLM (Zhipu) ────────────────────────────────────────────────────

export const GLM_MODELS: ModelInfo[] = [
  {
    id: 'glm-4-plus',
    display_name: 'GLM-4-Plus',
    capabilities: { ...STD_CAPS, context_window: 128000 },
    cost_per_million_input_tokens: 7.0,
    cost_per_million_output_tokens: 7.0,
  },
  {
    id: 'glm-4',
    display_name: 'GLM-4',
    capabilities: { ...STD_CAPS, context_window: 128000 },
    cost_per_million_input_tokens: 1.4,
    cost_per_million_output_tokens: 1.4,
  },
  {
    id: 'glm-4-flash',
    display_name: 'GLM-4-Flash (free tier eligible)',
    capabilities: { ...STD_CAPS, context_window: 128000 },
    cost_per_million_input_tokens: 0.0,
    cost_per_million_output_tokens: 0.0,
  },
  {
    id: 'glm-4v',
    display_name: 'GLM-4V (vision)',
    capabilities: { ...VISION_CAPS, context_window: 8192 },
    cost_per_million_input_tokens: 7.0,
    cost_per_million_output_tokens: 7.0,
  },
]

// ─── Anthropic ──────────────────────────────────────────────────────
// Provided here for symmetry; AnthropicProvider also imports.

export const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-6-20251022',
    display_name: 'Claude Sonnet 4.6',
    capabilities: {
      ...STD_CAPS,
      supports_vision: true,
      context_window: 200_000,
      max_output_tokens: 8192,
    },
    cost_per_million_input_tokens: 3.0,
    cost_per_million_output_tokens: 15.0,
    cost_per_million_cached_input_tokens: 0.3,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    display_name: 'Claude Haiku 4.5',
    capabilities: {
      ...STD_CAPS,
      supports_vision: true,
      context_window: 200_000,
      max_output_tokens: 8192,
    },
    cost_per_million_input_tokens: 0.8,
    cost_per_million_output_tokens: 4.0,
    cost_per_million_cached_input_tokens: 0.08,
  },
  {
    id: 'claude-opus-4-7-20260101',
    display_name: 'Claude Opus 4.7',
    capabilities: {
      ...STD_CAPS,
      supports_vision: true,
      context_window: 200_000,
      max_output_tokens: 8192,
    },
    cost_per_million_input_tokens: 15.0,
    cost_per_million_output_tokens: 75.0,
    cost_per_million_cached_input_tokens: 1.5,
  },
]
