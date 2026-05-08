// Long-term Critic role payload — see docs/prompts/06-long-term-critic.md §6.

import { z } from 'zod'

const HealthMetricsSchema = z.object({
  complexity_trend: z
    .enum(['decreasing', 'stable', 'increasing'])
    .default('stable'),
  duplication_observed: z.array(z.string()).default([]),
  abstraction_appropriateness: z.string().default(''),
  test_coverage_trend: z
    .enum(['improving', 'stable', 'degrading'])
    .default('stable'),
  estimated_files_modified_per_iteration_avg: z.number().nullable().optional(),
})

const FutureStressSchema = z.object({
  scenario: z.string(),
  what_breaks: z.string(),
  preventable_now: z.boolean(),
  prevention_cost: z.enum(['low', 'medium', 'high', 'n/a']).default('n/a'),
})

const TechDebtItemSchema = z.object({
  id: z.string(),
  introduced_in_iteration: z.number().int(),
  file: z.string(),
  issue: z.string(),
  interest_rate: z.enum(['low', 'medium', 'high']).default('medium'),
  principal: z.enum(['low', 'medium', 'high']).default('medium'),
  recommendation: z.enum(['ignore', 'track', 'pay_down_now']).default('track'),
})

const FragilityFlagSchema = z.object({
  where: z.string(),
  fragility: z.string(),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
})

const RefactorOpportunitySchema = z.object({
  what: z.string(),
  why_now: z.string(),
  estimated_iterations_payback: z.number().int(),
})

const BlockingRecommendationSchema = z.object({
  issue: z.string(),
  if_we_proceed: z.string(),
  alternative: z.string(),
  alternative_cost_now: z.enum(['low', 'medium', 'high']).default('medium'),
  ignoring_cost_later: z.enum(['low', 'medium', 'high']).default('high'),
})

export const LongTermCriticPayloadSchema = z
  .object({
    health_metrics: HealthMetricsSchema.optional(),
    future_stress_predictions: z.array(FutureStressSchema).default([]),
    tech_debt_inventory: z.array(TechDebtItemSchema).default([]),
    fragility_flags: z.array(FragilityFlagSchema).default([]),
    refactor_opportunities: z.array(RefactorOpportunitySchema).default([]),
    memory_lessons_to_persist: z.array(z.string()).default([]),
    blocking_recommendation: BlockingRecommendationSchema.optional(),
  })
  .passthrough()

export type LongTermCriticPayload = z.infer<typeof LongTermCriticPayloadSchema>
