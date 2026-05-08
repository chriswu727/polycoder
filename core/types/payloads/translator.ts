// Translator role payload — see docs/prompts/01-translator.md §6.

import { z } from 'zod'

export const TranslatorAmbiguitySchema = z.object({
  question: z.string(),
  default_assumption: z.string(),
})

export const TranslatorContradictionSchema = z.object({
  with: z.string(),
  user_said: z.string(),
  memory_said: z.string(),
  recommendation: z.string(),
})

export const TranslatorPayloadSchema = z
  .object({
    intent_summary: z.string().min(1),
    must_have: z.array(z.string()).default([]),
    should_have: z.array(z.string()).default([]),
    explicitly_out_of_scope: z.array(z.string()).default([]),
    ambiguities: z.array(TranslatorAmbiguitySchema).default([]),
    inferred_constraints: z.array(z.string()).default([]),
    is_iteration: z.boolean().default(false),
    delta_from_prior: z.string().nullable().default(null),
    contradictions: z.array(TranslatorContradictionSchema).optional(),
  })
  // Allow LLM to add fields we didn't anticipate without rejecting.
  .passthrough()

export type TranslatorPayload = z.infer<typeof TranslatorPayloadSchema>
