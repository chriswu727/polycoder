// update_project_memory tool. Architect-only. Per docs/specs/tools.md §4.6.
// Wraps the data-layer applyMemoryUpdate, which is transactional.

import { z } from 'zod'
import { buildTool } from './ToolDef.js'
import { applyMemoryUpdate } from '../data/projectMemory.js'
import { MemoryUpdateInputSchema } from '@core/types/projectMemory.js'

export const UpdateProjectMemoryInputSchema = MemoryUpdateInputSchema

export const UpdateProjectMemoryOutputSchema = z.object({
  decisions_added: z.number().int(),
  conventions_added: z.number().int(),
  components_added: z.number().int(),
  tech_debt_added: z.number().int(),
  superseded: z.number().int(),
  design_tokens_set: z.boolean(),
})

export const updateProjectMemoryTool = buildTool({
  name: 'update_project_memory',
  description:
    'Apply structured updates to project memory: add decisions / conventions / components / tech debt; supersede prior decisions; set design tokens. Transactional — partial failure rolls back. Architect role only.',
  inputSchema: UpdateProjectMemoryInputSchema,
  outputSchema: UpdateProjectMemoryOutputSchema,
  allowedRoles: ['architect'],

  async call(input, ctx) {
    return applyMemoryUpdate(
      ctx.db,
      { workspace_id: ctx.workspace_id, iteration_number: ctx.iteration_number },
      input,
    )
  },
})
