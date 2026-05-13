// Quick Edit — lightweight single-Coder orchestrator. Bypasses the
// full 8-role pipeline for fast targeted changes that vibe coders
// reach for dozens of times per session (Copilot/Cursor's daily-
// driver loop).
//
// Contract:
//   * Uses one provider/model (Coder's assignment by default).
//   * Restricted toolset: read_file, write_file, edit_file, bash,
//     run_test_suite, read_history. No memory writes, no
//     ask_user_question (would stall the loop).
//   * Target latency 5-15s; expected cost < $0.01.
//   * Persists as an iterations row whose role_outputs_json has
//     ONLY a `coder` entry — the UI uses that signature to render
//     Quick Edit rows distinctly from full pipeline runs.
//
// Why not just call invokeRole('coder', …)? invokeRole enforces the
// full <role-output> envelope contract (retries on parse failure,
// payload Zod validation). That's right for the 8-role pipeline
// where every role's output feeds the next. For Quick Edit, the
// model emits free-form prose + tool calls; we synthesize a minimal
// Coder envelope from the observed side effects.

import type Database from 'better-sqlite3'
import type { ModelProvider } from '@providers/ModelProvider.js'
import type { BuiltTool, ToolContext, ToolEvent } from '@tools/ToolDef.js'
import type { KeyStore } from '../../electron/secrets/keystore.js'
import type { Workspace } from '@core/types/workspace.js'
import type {
  RoleOutputEnvelope,
} from '@core/types/role.js'
import type {
  PipelineResultCompleted,
  PipelineResultFailed,
} from '@core/types/iteration.js'
import type { CoderPayload } from '@core/types/payloads/coder.js'
import { runWithTools, ToolLoopBudgetExceeded } from '../roleHarness/runWithTools.js'
import { ProviderError } from '@providers/errors.js'
import { ALL_TOOLS } from '@tools/registry.js'
import { startIteration, finishIteration } from '../../data/iterations.js'
import { appendCostRecord } from '../../data/costRecords.js'
import { PipelineEventBus } from './events.js'

const QUICK_EDIT_TOOLS = [
  'read_file',
  'write_file',
  'edit_file',
  'bash',
  'run_test_suite',
  'read_history',
] as const

const QUICK_EDIT_MAX_TOOL_CALLS = 30

const QUICK_EDIT_ROLE = 'coder' as const

export type QuickEditArgs = {
  db: Database.Database
  keystore: KeyStore
  workspace: Workspace
  instruction: string
  provider: ModelProvider
  model: string
  abort_signal?: AbortSignal
  eventBus?: PipelineEventBus
  /** Optional override (mostly for tests). */
  maxToolCalls?: number
}

export type QuickEditCompleted = {
  status: 'completed'
  iteration_id: string
  iteration_number: number
  summary: string
  files_changed: string[]
  tool_calls_made: number
  duration_ms: number
  total_cost_usd: number
  provider: string
  model: string
}

export type QuickEditFailed = {
  status: 'failed' | 'aborted'
  iteration_id: string
  iteration_number: number
  reason: string
  detail: string
  files_changed: string[]
  duration_ms: number
  total_cost_usd: number
}

export type QuickEditResult = QuickEditCompleted | QuickEditFailed

const QUICK_EDIT_SYSTEM_PROMPT = `
You are polycoder's Quick Edit assistant — a single fast loop for small,
targeted code changes inside the user's workspace.

Workflow:
1. If the user references a file or function, use read_file FIRST.
2. Make the minimum change that satisfies the instruction. Do not
   refactor adjacent code. Do not add new dependencies. Do not invent
   new files unless the instruction explicitly asks for one.
3. Use edit_file for surgical changes (preserves context). Use
   write_file only when creating a new file or overwriting wholesale.
4. After editing, briefly verify with read_file or a quick bash check
   if it's free; do not spin up a full test suite unless the instruction
   asks for it.
5. End with a one-paragraph summary of what changed and why. No
   XML envelope, no JSON — just plain prose that the user will read.

Hard rules:
- Stay inside the workspace root. Tool boundary enforcement is real;
  out-of-tree paths will be rejected.
- Do not delete files or directories.
- If the instruction is ambiguous, pick the smallest reasonable
  interpretation and note your assumption in the summary.
- Never claim you tested something you didn't run.
`.trim()

export async function runQuickEdit(args: QuickEditArgs): Promise<QuickEditResult> {
  const events = args.eventBus ?? new PipelineEventBus()
  const abort = args.abort_signal ?? new AbortController().signal

  const iteration = startIteration(args.db, {
    workspace_id: args.workspace.id,
    user_prompt: args.instruction,
  })

  events.emit({
    type: 'iteration_started',
    iteration_id: iteration.id,
    user_prompt: args.instruction,
  })
  events.emit({
    type: 'role_started',
    role: QUICK_EDIT_ROLE,
    model: args.model,
  })

  const filesTouched = new Set<string>()
  const emitEvent = (e: ToolEvent): void => {
    if (e.type === 'side_effect') {
      // Stable formats — see tools/writeFile.ts + tools/editFile.ts.
      const writeMatch = /^wrote \d+ bytes to (.+)$/.exec(e.description)
      const editMatch = /^edit_file (.+?): \d+ replacement/.exec(e.description)
      const m = writeMatch ?? editMatch
      if (m?.[1]) filesTouched.add(m[1])
    }
  }

  const ctx: ToolContext = {
    workspace_id: args.workspace.id,
    workspace_root: args.workspace.workspace_root,
    iteration_id: iteration.id,
    role: QUICK_EDIT_ROLE,
    abort_signal: abort,
    emit_event: emitEvent,
    db: args.db,
    keystore: args.keystore,
    read_files_in_iteration: new Set<string>(),
    iteration_number: iteration.iteration_number,
  }

  const tools: BuiltTool<unknown, unknown>[] = QUICK_EDIT_TOOLS
    .map((n) => ALL_TOOLS[n])
    .filter((t): t is BuiltTool<unknown, unknown> => !!t)

  const startedAt = Date.now()
  let summary = ''
  let finalStatus: 'completed' | 'failed' | 'aborted' = 'completed'
  let failureReason = ''
  let failureDetail = ''
  let toolCallsMade = 0
  let totalCostUsd = 0

  try {
    const userMessage = buildUserMessage(args.instruction, args.workspace)
    const run = await runWithTools({
      provider: args.provider,
      model: args.model,
      systemPrompt: QUICK_EDIT_SYSTEM_PROMPT,
      initialUserMessage: userMessage,
      tools,
      ctx,
      maxToolCalls: args.maxToolCalls ?? QUICK_EDIT_MAX_TOOL_CALLS,
    })
    summary = run.finalText.trim() || '(no summary)'
    toolCallsMade = run.toolCallsMade
    totalCostUsd = run.totalUsage.estimated_cost_usd

    appendCostRecord(args.db, {
      workspace_id: args.workspace.id,
      iteration_id: iteration.id,
      role: QUICK_EDIT_ROLE,
      provider: args.provider.id,
      model: args.model,
      usage: {
        input_tokens: run.totalUsage.input_tokens,
        output_tokens: run.totalUsage.output_tokens,
        cached_input_tokens: run.totalUsage.cached_input_tokens,
        total_tokens:
          run.totalUsage.input_tokens + run.totalUsage.output_tokens,
        estimated_cost_usd: run.totalUsage.estimated_cost_usd,
      },
      duration_ms: Date.now() - startedAt,
    })
  } catch (e) {
    if (abort.aborted) {
      finalStatus = 'aborted'
      failureReason = 'aborted'
      failureDetail = 'Aborted by user.'
    } else if (e instanceof ToolLoopBudgetExceeded) {
      finalStatus = 'failed'
      failureReason = 'tool_loop_budget_exceeded'
      failureDetail = e.message
    } else if (e instanceof ProviderError) {
      finalStatus = 'failed'
      failureReason = 'provider_error'
      failureDetail = `${e.code}: ${e.message}`
    } else {
      finalStatus = 'failed'
      failureReason = 'unknown'
      failureDetail = e instanceof Error ? e.message : String(e)
    }
  }

  const duration = Date.now() - startedAt
  const files_changed = Array.from(filesTouched).sort()
  const trafficLight = finalStatus === 'completed' ? 'green' : 'red'

  // Synthesize a minimal Coder envelope so the existing renderer can
  // show this as an iteration result without bespoke wiring.
  const synthesizedPayload: CoderPayload = {
    files_changed: files_changed.map((p) => ({
      path: p,
      action: 'edit',
      reason: 'Quick Edit',
      content_or_diff: '',
    })),
    files_skipped: [],
    uncertainties: [],
    follow_up_needed: [],
  }
  const envelope: RoleOutputEnvelope = {
    role: QUICK_EDIT_ROLE,
    iteration: iteration.iteration_number,
    model: args.model,
    status: finalStatus === 'completed' ? 'ok' : 'failed',
    summary:
      finalStatus === 'completed'
        ? summary.slice(0, 4000)
        : `Quick Edit ${finalStatus}: ${failureReason}`,
    payload: synthesizedPayload,
  }

  finishIteration(args.db, {
    iteration_id: iteration.id,
    status: finalStatus,
    traffic_light: trafficLight,
    total_cost_usd: totalCostUsd,
    files_changed,
    role_outputs: { coder: envelope },
    conflicts: [],
  })

  events.emit({
    type: 'role_completed',
    role: QUICK_EDIT_ROLE,
    envelope,
  })

  if (finalStatus === 'completed') {
    const result: PipelineResultCompleted = {
      status: 'completed',
      iteration_id: iteration.id,
      duration_ms: duration,
      total_cost_usd: totalCostUsd,
      role_outputs: { coder: envelope },
      conflicts: [],
      files_changed,
      traffic_light: trafficLight,
    }
    events.emit({ type: 'iteration_completed', result })
    return {
      status: 'completed',
      iteration_id: iteration.id,
      iteration_number: iteration.iteration_number,
      summary,
      files_changed,
      tool_calls_made: toolCallsMade,
      duration_ms: duration,
      total_cost_usd: totalCostUsd,
      provider: args.provider.id,
      model: args.model,
    }
  }

  if (finalStatus === 'aborted') {
    events.emit({
      type: 'iteration_aborted',
      result: {
        status: 'aborted',
        iteration_id: iteration.id,
        stopped_at_role: QUICK_EDIT_ROLE,
        reason: failureDetail,
        partial_outputs: { coder: envelope },
        cost_so_far_usd: totalCostUsd,
      },
    })
  } else {
    const result: PipelineResultFailed = {
      status: 'failed',
      iteration_id: iteration.id,
      stopped_at_role: QUICK_EDIT_ROLE,
      error: failureDetail,
      error_code: failureReason,
      partial_outputs: { coder: envelope },
      cost_so_far_usd: totalCostUsd,
    }
    events.emit({ type: 'iteration_failed', result })
  }

  return {
    status: finalStatus,
    iteration_id: iteration.id,
    iteration_number: iteration.iteration_number,
    reason: failureReason,
    detail: failureDetail,
    files_changed,
    duration_ms: duration,
    total_cost_usd: totalCostUsd,
  }
}

function buildUserMessage(instruction: string, workspace: Workspace): string {
  return [
    `Workspace: ${workspace.name}`,
    `Root: ${workspace.workspace_root}`,
    '',
    'Instruction:',
    instruction.trim(),
  ].join('\n')
}
