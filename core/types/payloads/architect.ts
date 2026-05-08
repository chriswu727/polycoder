// Architect role payload — see docs/prompts/03-architect.md §6.

import { z } from 'zod'

const PatternToFollowSchema = z.object({
  pattern: z.string(),
  why: z.string(),
  files_to_touch: z.array(z.string()).default([]),
})

const PatternToAvoidSchema = z.object({
  anti_pattern: z.string(),
  why: z.string(),
})

const NewDecisionDraftSchema = z.object({
  decision: z.string(),
  rationale: z.string(),
  supersedes: z.string().nullable().default(null),
})

const NewConventionDraftSchema = z.object({
  convention: z.string(),
  scope: z.string(),
})

const ComponentDraftSchema = z.object({
  name: z.string(),
  path: z.string(),
  purpose: z.string(),
})

const TechDebtDraftSchema = z.object({
  file: z.string(),
  issue: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  introduced_by_role: z
    .enum(['coder', 'designer', 'architect'])
    .nullable()
    .default(null),
})

const ConflictSchema = z.object({
  with: z.string(),
  this_iteration_wants: z.string(),
  memory_says: z.string(),
  recommendation: z.enum(['ask_user', 'override_memory', 'reject_iteration']),
})

const GuidanceSchema = z.object({
  patterns_to_follow: z.array(PatternToFollowSchema).default([]),
  patterns_to_avoid: z.array(PatternToAvoidSchema).default([]),
  naming_conventions: z.array(z.string()).default([]),
  files_likely_affected: z.array(z.string()).default([]),
})

const MemoryUpdatesSchema = z.object({
  new_decisions: z.array(NewDecisionDraftSchema).default([]),
  new_conventions: z.array(NewConventionDraftSchema).default([]),
  components_registered: z.array(ComponentDraftSchema).default([]),
})

export const ArchitectPayloadSchema = z
  .object({
    guidance_for_coder: GuidanceSchema.nullable().default(null),
    memory_updates: MemoryUpdatesSchema.nullable().default(null),
    conflicts: z.array(ConflictSchema).default([]),
    tech_debt_added: z.array(TechDebtDraftSchema).default([]),
    blocking_recommendation: z
      .union([
        z.string(),
        z
          .object({
            issue: z.string().optional(),
            if_we_proceed: z.string().optional(),
            alternative: z.string().optional(),
          })
          .passthrough(),
      ])
      .optional(),
  })
  .passthrough()

export type ArchitectPayload = z.infer<typeof ArchitectPayloadSchema>
