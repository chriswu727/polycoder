// read_history tool. Per docs/specs/tools.md §4.7.
// Long-term Critic and Architect only.

import { z } from 'zod'
import { buildTool } from './ToolDef.js'
import { listIterations, getIteration } from '../data/iterations.js'

export const ReadHistoryInputSchema = z.object({
  last_n: z.number().int().positive().max(50).default(10),
  include_full_envelopes: z.boolean().default(false),
})

const IterationSummaryPayloadSchema = z.object({
  iteration_number: z.number().int(),
  timestamp: z.string(),
  user_prompt: z.string(),
  intent_summary: z.string(),
  traffic_light: z.string(),
  coder_status: z.string(),
  test_runner_status: z.string(),
  files_changed: z.array(z.string()),
  full_envelopes: z.unknown().optional(),
})

export const ReadHistoryOutputSchema = z.object({
  iterations: z.array(IterationSummaryPayloadSchema),
})

export const readHistoryTool = buildTool({
  name: 'read_history',
  description:
    'Read summarized history of past iterations for this workspace. last_n controls page size (1..50). Set include_full_envelopes=true to include each iteration\'s role-output envelopes (much larger; only Long-term Critic should ask for this).',
  inputSchema: ReadHistoryInputSchema,
  outputSchema: ReadHistoryOutputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  allowedRoles: ['long_term_critic', 'architect'],

  async call(input, ctx) {
    const summaries = listIterations(ctx.db, ctx.workspace_id, { limit: input.last_n })
    const out = summaries.map((s) => {
      const base = {
        iteration_number: s.iteration_number,
        timestamp: new Date(s.started_at).toISOString(),
        user_prompt: s.user_prompt.slice(0, 500),
        intent_summary: extractIntentSummary(ctx.db, s.id) ?? '',
        traffic_light: s.traffic_light ?? 'unknown',
        coder_status: extractRoleStatus(ctx.db, s.id, 'coder') ?? 'unknown',
        test_runner_status:
          extractRoleStatus(ctx.db, s.id, 'test_runner') ?? 'unknown',
        files_changed: extractFilesChanged(ctx.db, s.id),
      }

      if (!input.include_full_envelopes) return base
      const full = getIteration(ctx.db, s.id)
      let envelopes: unknown = {}
      try {
        envelopes = full?.role_outputs_json
          ? JSON.parse(full.role_outputs_json)
          : {}
      } catch {
        envelopes = {}
      }
      return { ...base, full_envelopes: envelopes }
    })

    return { iterations: out }
  },
})

import type Database from 'better-sqlite3'

function extractIntentSummary(db: Database.Database, iterationId: string): string | null {
  const row = db
    .prepare('SELECT role_outputs_json FROM iterations WHERE id = ?')
    .get(iterationId) as { role_outputs_json: string } | undefined
  if (!row) return null
  try {
    const parsed = JSON.parse(row.role_outputs_json) as Record<
      string,
      { payload?: { intent_summary?: string }; summary?: string }
    >
    return parsed.translator?.payload?.intent_summary ?? parsed.translator?.summary ?? null
  } catch {
    return null
  }
}

function extractRoleStatus(
  db: Database.Database,
  iterationId: string,
  role: string,
): string | null {
  const row = db
    .prepare('SELECT role_outputs_json FROM iterations WHERE id = ?')
    .get(iterationId) as { role_outputs_json: string } | undefined
  if (!row) return null
  try {
    const parsed = JSON.parse(row.role_outputs_json) as Record<
      string,
      { status?: string } | undefined
    >
    return parsed[role]?.status ?? null
  } catch {
    return null
  }
}

function extractFilesChanged(db: Database.Database, iterationId: string): string[] {
  const row = db
    .prepare('SELECT files_changed FROM iterations WHERE id = ?')
    .get(iterationId) as { files_changed: string } | undefined
  if (!row) return []
  try {
    return JSON.parse(row.files_changed) as string[]
  } catch {
    return []
  }
}
