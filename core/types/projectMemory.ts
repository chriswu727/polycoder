// Project memory — Architect-maintained persistent state.
// See SPEC.md §5.4 and docs/specs/tools.md §4.6.

import { z } from 'zod'

// ─── Sub-shapes ──────────────────────────────────────────────────────

export const ConventionSchema = z.object({
  id: z.string().uuid(),
  convention: z.string().min(1),
  scope: z.string().min(1),
  added_in_iteration: z.number().int().nonnegative(),
  added_at: z.number().int(),
})

export type Convention = z.infer<typeof ConventionSchema>

export const DecisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.string().min(1),
  rationale: z.string().min(1),
  supersedes: z.string().uuid().nullable(),
  superseded_by: z.string().uuid().nullable(),
  added_in_iteration: z.number().int().nonnegative(),
  added_at: z.number().int(),
})

export type Decision = z.infer<typeof DecisionSchema>

export const ComponentRegistryEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  path: z.string().min(1),
  purpose: z.string().min(1),
  added_in_iteration: z.number().int().nonnegative(),
  added_at: z.number().int(),
})

export type ComponentRegistryEntry = z.infer<typeof ComponentRegistryEntrySchema>

export const TechDebtSchema = z.object({
  id: z.string().uuid(),
  file: z.string().min(1),
  issue: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  introduced_by_role: z.enum(['coder', 'designer', 'architect']).nullable(),
  added_in_iteration: z.number().int().nonnegative(),
  added_at: z.number().int(),
  resolved: z.boolean().default(false),
  resolved_in_iteration: z.number().int().nonnegative().nullable(),
})

export type TechDebt = z.infer<typeof TechDebtSchema>

export const DesignTokensSchema = z.object({
  colors: z.record(z.string(), z.string()),
  typography: z.object({
    font_family: z.string(),
    scale: z.array(z.string()),
  }),
  spacing: z.object({
    unit: z.string(),
    scale: z.array(z.number()),
  }),
  established_in_iteration: z.number().int().nonnegative().nullable(),
})

export type DesignTokens = z.infer<typeof DesignTokensSchema>

export const EMPTY_DESIGN_TOKENS: DesignTokens = {
  colors: {},
  typography: { font_family: '', scale: [] },
  spacing: { unit: '4px', scale: [] },
  established_in_iteration: null,
}

// ─── ProjectMemory (the aggregate) ──────────────────────────────────

export const ProjectMemorySchema = z.object({
  workspace_id: z.string().uuid(),
  conventions: z.array(ConventionSchema),
  decisions: z.array(DecisionSchema),
  components_registry: z.array(ComponentRegistryEntrySchema),
  tech_debt: z.array(TechDebtSchema),
  design_tokens: DesignTokensSchema,
  updated_at: z.number().int(),
})

export type ProjectMemory = z.infer<typeof ProjectMemorySchema>

export function emptyProjectMemory(workspaceId: string): ProjectMemory {
  return {
    workspace_id: workspaceId,
    conventions: [],
    decisions: [],
    components_registry: [],
    tech_debt: [],
    design_tokens: EMPTY_DESIGN_TOKENS,
    updated_at: Date.now(),
  }
}

// ─── Memory update payload (the Architect's update_project_memory input) ─

export const MemoryUpdateInputSchema = z.object({
  add_conventions: z.array(
    ConventionSchema.omit({ id: true, added_at: true }).partial({
      added_in_iteration: true,
    }),
  ).optional(),
  add_decisions: z.array(
    DecisionSchema.omit({
      id: true,
      added_at: true,
      supersedes: true,
      superseded_by: true,
    }).partial({ added_in_iteration: true }),
  ).optional(),
  add_components: z.array(
    ComponentRegistryEntrySchema.omit({ id: true, added_at: true }).partial({
      added_in_iteration: true,
    }),
  ).optional(),
  add_tech_debt: z.array(
    TechDebtSchema.omit({
      id: true,
      added_at: true,
      resolved: true,
      resolved_in_iteration: true,
    }).partial({ added_in_iteration: true }),
  ).optional(),
  supersede_decisions: z
    .array(
      z.object({
        old_decision_id: z.string().uuid(),
        new_decision: DecisionSchema.omit({
          id: true,
          added_at: true,
          supersedes: true,
          superseded_by: true,
        }).partial({ added_in_iteration: true }),
      }),
    )
    .optional(),
  set_design_tokens: DesignTokensSchema.optional(),
})

export type MemoryUpdateInput = z.infer<typeof MemoryUpdateInputSchema>
