// Convert a ToolDef into the provider-native tool schema shape. The
// providers/ layer's adapters handle the final wrapping; this helper
// produces the JSON Schema that goes into either OpenAI's
// { type: 'function', function: { parameters: ... } } or Anthropic's
// { name, description, input_schema: ... }.
//
// Zod v4 ships its own `z.toJSONSchema()` — we use that, not the
// third-party zod-to-json-schema package (which targets v3 internals).

import { z } from 'zod'
import type { ToolDef } from './ToolDef.js'
import type { ToolSchema } from '@providers/ModelProvider.js'

/**
 * Convert a tool to the provider-neutral ToolSchema shape (consumed
 * by ChatRequest.tools). Adapters then translate to native shapes.
 */
export function toolToSchema<I, O>(tool: ToolDef<I, O>): ToolSchema {
  const inputSchema = z.toJSONSchema(tool.inputSchema)
  return {
    name: tool.name,
    description: tool.description,
    input_schema: inputSchema as Record<string, unknown>,
  }
}
