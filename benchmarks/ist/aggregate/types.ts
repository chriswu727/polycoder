// Aggregated IST results. One AggregateResults record per IST run,
// derived from the per-iter IterMetrics files.

import { z } from 'zod'

export const CellAggregateSchema = z.object({
  system: z.string(),
  template: z.string(),
  iters_present: z.array(z.number().int()),
  bpr_pass_rate: z.number().min(0).max(1).nullable(),
  spr_pass_rate: z.number().min(0).max(1).nullable(),
  tcmr_pass_rate: z.number().min(0).max(1).nullable(),
  break_count: z.number().int().nonnegative(),
  longest_break_run: z.number().int().nonnegative(),
  ccd_mean_iter1: z.number().nullable(),
  ccd_mean_iter5: z.number().nullable(),
  ccd_drift_iter5: z.number().nullable(),
})
export type CellAggregate = z.infer<typeof CellAggregateSchema>

export const SystemAggregateSchema = z.object({
  system: z.string(),
  templates_with_data: z.array(z.string()),
  bpr_pass_rate: z.number().nullable(),
  spr_pass_rate: z.number().nullable(),
  tcmr_pass_rate: z.number().nullable(),
  total_breaks: z.number().int().nonnegative(),
  total_iters: z.number().int().nonnegative(),
  ccd_drift_mean_at_iter5: z.number().nullable(),
})
export type SystemAggregate = z.infer<typeof SystemAggregateSchema>

export const AggregateResultsSchema = z.object({
  generated_at: z.string(),
  systems_in_scope: z.array(z.string()),
  templates_in_scope: z.array(z.string()),
  cells: z.array(CellAggregateSchema),
  systems: z.array(SystemAggregateSchema),
  warnings: z.array(z.string()),
})
export type AggregateResults = z.infer<typeof AggregateResultsSchema>

export const RawRecordSchema = z.object({
  system: z.string(),
  template: z.string(),
  iter: z.number().int(),
  bpr_status: z.string(),
  spr_status: z.string(),
  tcmr_status: z.string(),
  ccd_status: z.string(),
  ccd_mean: z.number().nullable(),
  ccd_drift: z.number().nullable(),
  computed_at: z.string(),
  /** Free-form short reason strings for fast scanning. */
  notes: z.array(z.string()),
})
export type RawRecord = z.infer<typeof RawRecordSchema>
