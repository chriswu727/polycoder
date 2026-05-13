// Iteration: the unit of work in polycoder. One pass through all 8 roles.
// See docs/specs/orchestrator.md §2 (state machine), §9 (result contract).

import { z } from 'zod'
import { RoleTypeSchema, RoleOutputEnvelopeSchema } from './role.js'

// ─── Iteration record (one row per pipeline run, persisted) ──────────

export const IterationStatusSchema = z.enum([
  'running',
  'awaiting_user',
  'completed',
  'aborted',
  'failed',
])

export type IterationStatus = z.infer<typeof IterationStatusSchema>

export const IterationTrafficLightSchema = z.enum(['green', 'yellow', 'red'])

export type IterationTrafficLight = z.infer<typeof IterationTrafficLightSchema>

export const IterationRecordSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  iteration_number: z.number().int().nonnegative(),
  user_prompt: z.string(),
  status: IterationStatusSchema,
  traffic_light: IterationTrafficLightSchema.nullable(),
  started_at: z.number().int(),
  ended_at: z.number().int().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  total_cost_usd: z.number().nonnegative().nullable(),
  files_changed: z.array(z.string()),
  // Stored as JSON: full role envelopes keyed by RoleType.
  role_outputs_json: z.string(),
  // Stored as JSON: detected conflicts.
  conflicts_json: z.string(),
})

export type IterationRecord = z.infer<typeof IterationRecordSchema>

// ─── Conflict (detected by the orchestrator after parallel reviewers) ──

export const RoleConflictSchema = z.object({
  id: z.string(),
  type: z.enum([
    'adversary_flagged_test_passed',
    'critic_warns_coder_proceeds',
    'architect_overridden_silently',
    'reviewers_disagree_on_severity',
    'test_failed_coder_ok',
  ]),
  involved_roles: z.array(RoleTypeSchema),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string(),
  user_action_required: z.boolean(),
})

export type RoleConflict = z.infer<typeof RoleConflictSchema>

// ─── Pipeline result (returned by orchestrator.runIteration) ─────────

export type PipelineResultCompleted = {
  status: 'completed'
  iteration_id: string
  duration_ms: number
  total_cost_usd: number
  role_outputs: Partial<Record<z.infer<typeof RoleTypeSchema>, z.infer<typeof RoleOutputEnvelopeSchema>>>
  conflicts: RoleConflict[]
  files_changed: string[]
  traffic_light: IterationTrafficLight
}

export type PipelineResultAborted = {
  status: 'aborted'
  iteration_id: string
  stopped_at_role: z.infer<typeof RoleTypeSchema>
  reason: string
  partial_outputs: Partial<Record<z.infer<typeof RoleTypeSchema>, z.infer<typeof RoleOutputEnvelopeSchema>>>
  cost_so_far_usd: number
}

export type PipelineResultFailed = {
  status: 'failed'
  iteration_id: string
  stopped_at_role: z.infer<typeof RoleTypeSchema>
  error: string
  error_code: string
  partial_outputs: Partial<Record<z.infer<typeof RoleTypeSchema>, z.infer<typeof RoleOutputEnvelopeSchema>>>
  cost_so_far_usd: number
}

export type PipelineResult =
  | PipelineResultCompleted
  | PipelineResultAborted
  | PipelineResultFailed

// ─── Pipeline events (emitted during a run; UI subscribes) ───────────

export type PipelineEvent =
  | { type: 'iteration_started'; iteration_id: string; user_prompt: string }
  | { type: 'role_started'; role: z.infer<typeof RoleTypeSchema>; model: string }
  | { type: 'role_completed'; role: z.infer<typeof RoleTypeSchema>; envelope: z.infer<typeof RoleOutputEnvelopeSchema> }
  | { type: 'role_failed'; role: z.infer<typeof RoleTypeSchema>; error: string }
  | { type: 'role_retried'; role: z.infer<typeof RoleTypeSchema>; attempt: number; reason: string }
  | { type: 'awaiting_user'; prompt: string; options?: string[] }
  | { type: 'user_responded'; response: string }
  | { type: 'conflict_detected'; conflict: RoleConflict }
  | { type: 'iteration_completed'; result: PipelineResultCompleted }
  | { type: 'iteration_aborted'; result: PipelineResultAborted }
  | { type: 'iteration_failed'; result: PipelineResultFailed }
  | { type: 'cost_update'; cumulative_usd: number }
  | {
      type: 'tool_call_progress'
      role: z.infer<typeof RoleTypeSchema>
      tool_name: string
      args_brief: string
      duration_ms: number
      ok: boolean
      error_brief?: string
    }
