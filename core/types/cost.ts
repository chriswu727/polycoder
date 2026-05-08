// Cost & token tracking. See docs/specs/providers.md §5 (cost tracking)
// and docs/specs/orchestrator.md §8.

import { z } from 'zod'
import { ProviderIdSchema } from './workspace.js'
import { RoleTypeSchema } from './role.js'

// ─── TokenUsage (returned by every provider call) ────────────────────

export const TokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative().default(0),
  total_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative(),
})

export type TokenUsage = z.infer<typeof TokenUsageSchema>

// ─── CostRecord (one row per role invocation, persisted) ─────────────

export const CostRecordSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  iteration_id: z.string().uuid(),
  role: RoleTypeSchema,
  provider: ProviderIdSchema,
  model: z.string().min(1),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cached_input_tokens: z.number().int().nonnegative().default(0),
  estimated_cost_usd: z.number().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  recorded_at: z.number().int(),
})

export type CostRecord = z.infer<typeof CostRecordSchema>

// ─── Aggregates ──────────────────────────────────────────────────────

export type CostAggregate = {
  total_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
  total_cached_input_tokens: number
  call_count: number
}

export const EMPTY_AGGREGATE: CostAggregate = {
  total_cost_usd: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  total_cached_input_tokens: 0,
  call_count: 0,
}
