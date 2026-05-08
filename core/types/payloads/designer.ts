// Designer role payload — see docs/prompts/02-designer.md §6.

import { z } from 'zod'

const ComponentSpecSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  structure: z.string(),
  props_summary: z.string().optional(),
  states: z.array(z.string()).default([]),
  is_new: z.boolean().default(true),
})

const InteractionPatternSchema = z.object({
  pattern: z.string(),
  applies_to: z.string(),
  rationale: z.string().optional(),
})

const DesignTokensInlineSchema = z.object({
  colors: z.record(z.string(), z.string()).default({}),
  typography: z
    .object({
      font_family: z.string(),
      scale: z.array(z.string()).default([]),
    })
    .optional(),
  spacing: z
    .object({
      unit: z.string(),
      scale: z.array(z.number()).default([]),
    })
    .optional(),
})

const BlockingIssueSchema = z.object({
  issue: z.string(),
  affected_components: z.array(z.string()).default([]),
  suggested_resolution: z.string().optional(),
})

export const DesignerPayloadSchema = z
  .object({
    layout: z
      .object({
        primary_view: z.string(),
        navigation_pattern: z.string(),
        responsive_breakpoints: z.array(z.string()).default([]),
      })
      .passthrough(),
    components: z.array(ComponentSpecSchema).default([]),
    design_tokens: DesignTokensInlineSchema.default({ colors: {} }),
    interaction_patterns: z.array(InteractionPatternSchema).default([]),
    accessibility_notes: z.array(z.string()).default([]),
    ui_lang: z.string().default('zh-CN'),
    delta_from_prior: z.string().nullable().default(null),
    blocking_issues: z.array(BlockingIssueSchema).optional(),
  })
  .passthrough()

export type DesignerPayload = z.infer<typeof DesignerPayloadSchema>
