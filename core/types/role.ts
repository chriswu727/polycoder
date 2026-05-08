// Core role-related types. The 8 cognitive roles in the polycoder pipeline.
// See docs/prompts/ for each role's contract; docs/specs/orchestrator.md
// for the pipeline state machine.

import { z } from 'zod'

// ─── RoleType ────────────────────────────────────────────────────────

export const RoleTypeSchema = z.enum([
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
])

export type RoleType = z.infer<typeof RoleTypeSchema>

export const ALL_ROLES: readonly RoleType[] = [
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
] as const

// ─── RoleOutput envelope (XML-tagged in transit, parsed to this shape) ──

export const RoleOutputStatusSchema = z.enum([
  'ok',
  'flagged',
  'failed',
  'partial',
  'cannot_run',
  'cannot_assess',
  'clean',
  'passed',
  'needs_clarification',
  'conflict_detected',
  'memory_only',
  'incomplete',
  'healthy',
  'warning',
  'critical',
  'green',
  'yellow',
  'red',
])

export type RoleOutputStatus = z.infer<typeof RoleOutputStatusSchema>

/**
 * The structured form of a `<role-output>` envelope after parsing.
 * The payload is role-specific; here we keep it loose (z.unknown())
 * because per-role payload validation happens in the role harness
 * after envelope parsing succeeds.
 */
export const RoleOutputEnvelopeSchema = z.object({
  role: RoleTypeSchema,
  iteration: z.number().int().nonnegative(),
  model: z.string().min(1),
  status: RoleOutputStatusSchema,
  summary: z.string().min(1),
  payload: z.unknown(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      duration_ms: z.number().int().nonnegative(),
    })
    .optional(),
})

export type RoleOutputEnvelope = z.infer<typeof RoleOutputEnvelopeSchema>
