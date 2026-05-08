// Coder role payload — see docs/prompts/04-coder.md §6.

import { z } from 'zod'

const FileChangeSchema = z.object({
  path: z.string(),
  action: z.enum(['create', 'edit', 'delete']),
  reason: z.string(),
  content_or_diff: z.string(),
})

const FileSkippedSchema = z.object({
  path: z.string(),
  reason: z.string(),
})

const UncertaintySchema = z.object({
  where: z.string(),
  issue: z.string(),
})

const ArchitectDisagreementSchema = z.object({
  with_pattern: z.string(),
  reason: z.string(),
  what_i_did_instead: z.string(),
})

export const CoderPayloadSchema = z
  .object({
    files_changed: z.array(FileChangeSchema).default([]),
    files_skipped: z.array(FileSkippedSchema).default([]),
    uncertainties: z.array(UncertaintySchema).default([]),
    follow_up_needed: z.array(z.string()).default([]),
    architect_disagreement: ArchitectDisagreementSchema.optional(),
  })
  .passthrough()

export type CoderPayload = z.infer<typeof CoderPayloadSchema>
