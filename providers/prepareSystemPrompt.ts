// prepareSystemPrompt — shared helper that splits a polycoder system
// prompt on the cache-boundary marker and emits provider-native shape.
// See ADR-009 (cache boundary) and docs/specs/providers.md §8.

export const POLYCODER_PROMPT_BOUNDARY = '___POLYCODER_PROMPT_BOUNDARY___'

/**
 * Result for a generic OpenAI-compat provider: the marker is stripped
 * and the assembled prompt is returned as a single string. Implicit
 * caching kicks in based on prefix matching at the provider level.
 */
export type OpenAICompatSystemPrompt = {
  text: string
}

/**
 * Result for Anthropic: the prompt is split into two `system` content
 * blocks. The first carries `cache_control: { type: 'ephemeral' }` to
 * mark the cache boundary explicitly.
 *
 * If no marker is present, this collapses to a single block with no
 * cache_control.
 */
export type AnthropicSystemPrompt =
  | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>

/**
 * Strip the polycoder boundary marker from a string. Used by
 * OpenAI-compat providers where caching is automatic and the marker
 * is just noise.
 */
export function prepareForOpenAICompat(systemPrompt: string): OpenAICompatSystemPrompt {
  return { text: systemPrompt.replaceAll(POLYCODER_PROMPT_BOUNDARY, '').trim() }
}

/**
 * Split a polycoder system prompt for Anthropic. Returns up to 2
 * content blocks; the first has cache_control if a boundary was
 * present.
 */
export function prepareForAnthropic(systemPrompt: string): AnthropicSystemPrompt {
  if (!systemPrompt.includes(POLYCODER_PROMPT_BOUNDARY)) {
    return [{ type: 'text', text: systemPrompt }]
  }
  const idx = systemPrompt.indexOf(POLYCODER_PROMPT_BOUNDARY)
  const before = systemPrompt.slice(0, idx).trimEnd()
  const after = systemPrompt
    .slice(idx + POLYCODER_PROMPT_BOUNDARY.length)
    .trimStart()
  const blocks: AnthropicSystemPrompt = []
  if (before) {
    blocks.push({
      type: 'text',
      text: before,
      cache_control: { type: 'ephemeral' },
    })
  }
  if (after) {
    blocks.push({ type: 'text', text: after })
  }
  return blocks
}
