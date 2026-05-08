// read_design_tokens tool. Designer-only. Per docs/specs/tools.md §4.9.
// Reads the design_tokens sub-tree out of project memory.

import { z } from 'zod'
import { buildTool, ToolError } from './ToolDef.js'
import { getProjectMemory } from '../data/projectMemory.js'
import { DesignTokensSchema } from '@core/types/projectMemory.js'

export const ReadDesignTokensInputSchema = z.object({}).default({})

export const ReadDesignTokensOutputSchema = DesignTokensSchema

export const readDesignTokensTool = buildTool({
  name: 'read_design_tokens',
  description:
    'Read the project\'s current design tokens (colors, typography scale, spacing scale). Returns null fields on iteration 1 (no tokens established yet); use those as a signal to establish tokens. Designer role only.',
  inputSchema: ReadDesignTokensInputSchema,
  outputSchema: ReadDesignTokensOutputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  allowedRoles: ['designer'],

  async call(_input, ctx) {
    const memory = getProjectMemory(ctx.db, ctx.workspace_id)
    if (!memory) {
      throw new ToolError(
        'unknown',
        'read_design_tokens',
        `No project memory for workspace ${ctx.workspace_id}.`,
        false,
      )
    }
    return memory.design_tokens
  },
})
