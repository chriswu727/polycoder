// read_project_memory tool. Per docs/specs/tools.md §4.5.
// Available to all roles; read-only.

import { z } from 'zod'
import { buildTool, ToolError } from './ToolDef.js'
import { getProjectMemory } from '../data/projectMemory.js'
import { ProjectMemorySchema, type ProjectMemory } from '@core/types/projectMemory.js'

const SECTION_VALUES = [
  'all',
  'conventions',
  'decisions',
  'components_registry',
  'pending_tech_debt',
  'design_tokens',
] as const

export const ReadProjectMemoryInputSchema = z.object({
  section: z.enum(SECTION_VALUES).default('all'),
})

export const ReadProjectMemoryOutputSchema = z.object({
  workspace_id: z.string(),
  section: z.enum(SECTION_VALUES),
  memory: z.unknown(),
})

export const readProjectMemoryTool = buildTool({
  name: 'read_project_memory',
  description:
    'Read the current project memory snapshot. Returns the full ProjectMemory by default; pass section=conventions|decisions|components_registry|pending_tech_debt|design_tokens to fetch a single sub-tree.',
  inputSchema: ReadProjectMemoryInputSchema,
  outputSchema: ReadProjectMemoryOutputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  // All 8 roles may read memory.

  async call(input, ctx) {
    const memory = getProjectMemory(ctx.db, ctx.workspace_id)
    if (!memory) {
      throw new ToolError(
        'unknown',
        'read_project_memory',
        `No project memory for workspace ${ctx.workspace_id}.`,
        false,
      )
    }
    const section: typeof input.section = input.section
    return {
      workspace_id: memory.workspace_id,
      section,
      memory: section === 'all' ? memory : selectSection(memory, section),
    }
  },
})

function selectSection(
  m: ProjectMemory,
  section: Exclude<(typeof SECTION_VALUES)[number], 'all'>,
): unknown {
  switch (section) {
    case 'conventions':
      return m.conventions
    case 'decisions':
      return m.decisions
    case 'components_registry':
      return m.components_registry
    case 'pending_tech_debt':
      return m.tech_debt
    case 'design_tokens':
      return m.design_tokens
  }
}

// Re-export for downstream type-safety where needed.
export { ProjectMemorySchema }
