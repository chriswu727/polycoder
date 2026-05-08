// Communicator role payload — see docs/prompts/08-communicator.md §6.

import { z } from 'zod'

const StanceSchema = z.object({
  role: z.string(),
  stance: z.string(),
  model_label: z.string(),
})

const DisagreementCardSchema = z.object({
  card_id: z.string(),
  between: z.array(z.string()).default([]),
  topic: z.string(),
  stances: z.array(StanceSchema).default([]),
  user_action_required: z.string(),
  default_if_user_skips: z.string(),
})

const NextActionSchema = z.object({
  suggestion: z.string(),
  priority: z.enum(['must', 'recommended', 'optional']).default('recommended'),
})

const StatsSchema = z.object({
  models_used: z.array(z.string()).default([]),
  estimated_cost_usd: z.string().optional(),
  duration_seconds: z.number().optional(),
})

export const CommunicatorPayloadSchema = z
  .object({
    user_facing_text: z.string().min(1),
    traffic_light: z.enum(['green', 'yellow', 'red']).default('yellow'),
    traffic_light_reason: z.string().default(''),
    disagreement_cards: z.array(DisagreementCardSchema).default([]),
    what_changed: z.array(z.string()).default([]),
    what_to_do_next: z.array(NextActionSchema).default([]),
    stats: StatsSchema.optional(),
  })
  .passthrough()

export type CommunicatorPayload = z.infer<typeof CommunicatorPayloadSchema>
