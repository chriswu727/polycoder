// Metric record types for the Iteration Survival Test.
// One IterMetrics record per (system, template, iter) cell.
//
// Spec: docs/specs/iteration-survival-test.md §6.

import { z } from 'zod'

export const MetricStatusSchema = z.enum(['pass', 'fail', 'na', 'error'])
export type MetricStatus = z.infer<typeof MetricStatusSchema>

export const BPRSchema = z.object({
  status: MetricStatusSchema,
  applicable: z.boolean(),
  applicable_reason: z.string(),
  build_kind: z.enum(['static', 'pnpm', 'npm', 'none']),
  exit_code: z.number().int().nullable(),
  duration_ms: z.number().int().nonnegative(),
  stdout_tail: z.string().optional(),
  stderr_tail: z.string().optional(),
  served_dir: z.string().nullable(),
})
export type BPR = z.infer<typeof BPRSchema>

export const SPRSchema = z.object({
  status: MetricStatusSchema,
  applicable: z.boolean(),
  applicable_reason: z.string(),
  console_errors: z.array(z.string()),
  golden_captured: z
    .object({
      text_fragments: z.array(z.string()),
      interactive_count: z.number().int().nonnegative(),
    })
    .nullable(),
  persistence_check: z
    .object({
      checked_against_iter: z.number().int().positive(),
      missing_text_fragments: z.array(z.string()),
      interactive_count_now: z.number().int().nonnegative(),
      interactive_count_prior: z.number().int().nonnegative(),
      below_count_threshold: z.boolean(),
    })
    .nullable(),
  duration_ms: z.number().int().nonnegative(),
})
export type SPR = z.infer<typeof SPRSchema>

export const TCMRSchema = z.object({
  status: MetricStatusSchema,
  applicable: z.boolean(),
  applicable_reason: z.string(),
  test_command: z.string().nullable(),
  exit_code: z.number().int().nullable(),
  duration_ms: z.number().int().nonnegative(),
  stdout_tail: z.string().optional(),
})
export type TCMR = z.infer<typeof TCMRSchema>

export const CCDSchema = z.object({
  status: MetricStatusSchema,
  applicable: z.boolean(),
  applicable_reason: z.string(),
  files_analyzed: z.number().int().nonnegative(),
  mean_complexity: z.number().nullable(),
  max_complexity: z.number().nullable(),
  drift_from_iter1: z.number().nullable(),
  duration_ms: z.number().int().nonnegative(),
})
export type CCD = z.infer<typeof CCDSchema>

export const IterMetricsSchema = z.object({
  cell: z.object({
    system: z.string(),
    template: z.string(),
    iter: z.number().int().min(1).max(5),
  }),
  computed_at: z.string(),
  build_pass_rate: BPRSchema,
  smoke_pass_rate: SPRSchema,
  test_coverage_maintenance: TCMRSchema,
  complexity_drift: CCDSchema,
})
export type IterMetrics = z.infer<typeof IterMetricsSchema>
