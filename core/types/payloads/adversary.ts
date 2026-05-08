// Adversary role payload — see docs/prompts/05-adversary.md §6.

import { z } from 'zod'

const IssueSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  category: z.string(), // freeform; suggested values in prompt but not strict
  where: z.string(),
  issue: z.string(),
  evidence: z.string(),
  suggested_fix: z.string(),
})

const CouldNotAssessSchema = z.object({
  what: z.string(),
  why: z.string(),
})

export const AdversaryPayloadSchema = z
  .object({
    issues: z.array(IssueSchema).default([]),
    checked_categories: z.array(z.string()).default([]),
    explicit_negative_findings: z.array(z.string()).default([]),
    confidence: z.enum(['high', 'medium', 'low']).default('medium'),
    could_not_assess: z.array(CouldNotAssessSchema).default([]),
  })
  .passthrough()

export type AdversaryPayload = z.infer<typeof AdversaryPayloadSchema>
