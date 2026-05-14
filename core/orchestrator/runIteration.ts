// runIteration — top-level orchestrator state machine. Per
// docs/specs/orchestrator.md §13.
//
// Flow:
//   ITERATION_START → TRANSLATING → DESIGNING → ARCHITECTING
//     → CODING → [parallel: ADVERSARY‖LTC‖TESTRUNNER]
//     → CONFLICT_DETECT → COMMUNICATING → ITERATION_END
//
// Failure modes return PipelineResult with status: 'failed' or
// 'aborted'. Memory updates are applied only on full success.

import type Database from 'better-sqlite3'
import type { ModelProvider } from '@providers/ModelProvider.js'
import type { ToolContext } from '@tools/ToolDef.js'
import type { KeyStore } from '../../electron/secrets/keystore.js'
import type {
  PipelineResult,
  PipelineResultCompleted,
  PipelineResultFailed,
  PipelineResultAborted,
  IterationTrafficLight,
} from '@core/types/iteration.js'
import type {
  RoleType,
  RoleOutputEnvelope,
} from '@core/types/role.js'
import type { Workspace } from '@core/types/workspace.js'
import { invokeRole, type InvokeRoleResult } from '../roleHarness/invokeRole.js'
import { detectConflicts } from './conflictDetection.js'
import { applyMemoryUpdates } from './applyMemoryUpdates.js'
import { CostTracker } from './CostTracker.js'
import { PipelineError } from './PipelineError.js'
import { PipelineEventBus } from './events.js'
import {
  startIterationTrace,
  finishIterationTrace,
} from './iterationTrace.js'
import { getProjectMemory } from '../../data/projectMemory.js'
import { listIterations } from '../../data/iterations.js'
import { loadProjectRules } from './projectRules.js'
import type { CommunicatorPayload } from '@core/types/payloads/communicator.js'
import type { CoderPayload } from '@core/types/payloads/coder.js'

// ─── Public API ─────────────────────────────────────────────────────

/** A factory that produces a (provider, model) for each role. The
 *  orchestrator calls this once per role invocation. Lets tests
 *  inject mocks without going through the Secret/registry path. */
export type ProviderFactory = (role: RoleType) => Promise<{
  provider: ModelProvider
  model: string
}>

export type RunIterationArgs = {
  db: Database.Database
  keystore: KeyStore
  workspace: Workspace
  user_prompt: string
  providerFactory: ProviderFactory
  abort_signal?: AbortSignal
  /** Optional event bus to pipe progress to. */
  eventBus?: PipelineEventBus
}

export async function runIteration(
  args: RunIterationArgs,
): Promise<PipelineResult> {
  const events = args.eventBus ?? new PipelineEventBus()
  const costTracker = new CostTracker()
  const abort = args.abort_signal ?? new AbortController().signal

  // 1. Create iteration row + trace state.
  const trace = startIterationTrace({
    db: args.db,
    workspace_id: args.workspace.id,
    user_prompt: args.user_prompt,
  })

  events.emit({
    type: 'iteration_started',
    iteration_id: trace.iteration_id,
    user_prompt: args.user_prompt,
  })

  const outputs: Partial<Record<RoleType, RoleOutputEnvelope>> = {}
  const filesChangedSet = new Set<string>()

  // 2. Snapshot project memory + iteration count for prompt context.
  const project_memory = getProjectMemory(args.db, args.workspace.id)
  const total_iterations = listIterations(args.db, args.workspace.id, {
    limit: 1,
  })[0]?.iteration_number
    ? trace.iteration_number - 1
    : 0

  const baseCtx = (role: RoleType): ToolContext => ({
    workspace_id: args.workspace.id,
    workspace_root: args.workspace.workspace_root,
    iteration_id: trace.iteration_id,
    role,
    abort_signal: abort,
    emit_event: () => {},
    db: args.db,
    keystore: args.keystore,
    read_files_in_iteration: new Set<string>(),
    iteration_number: trace.iteration_number,
  })

  const projectRules = loadProjectRules(args.workspace.workspace_root)
  const promptInputs = {
    workspace_name: args.workspace.name,
    iteration_number: trace.iteration_number,
    project_memory,
    total_iterations,
    ...(projectRules ? { project_rules_text: projectRules.text } : {}),
  }

  try {
    // ─── Sequential: Translator → Designer → Architect → Coder ──

    const translator = await invokeOne({
      role: 'translator',
      args,
      events,
      costTracker,
      ctx: baseCtx('translator'),
      promptInputs,
      envelopeInputs: {
        project_memory,
        task: args.user_prompt,
      },
    })
    if (translator.status !== 'success') {
      return finalizeFailure({
        ...args,
        events,
        outputs,
        filesChanged: filesChangedSet,
        costTracker,
        trace,
        stoppedAt: 'translator',
        result: translator,
      })
    }
    outputs.translator = translator.envelope

    const designer = await invokeOne({
      role: 'designer',
      args,
      events,
      costTracker,
      ctx: baseCtx('designer'),
      promptInputs,
      envelopeInputs: {
        project_memory,
        task: { translator_output: translator.envelope },
      },
    })
    if (designer.status !== 'success') {
      return finalizeFailure({
        ...args, events, outputs, filesChanged: filesChangedSet, costTracker, trace,
        stoppedAt: 'designer', result: designer,
      })
    }
    outputs.designer = designer.envelope

    const architect = await invokeOne({
      role: 'architect',
      args,
      events,
      costTracker,
      ctx: baseCtx('architect'),
      promptInputs,
      envelopeInputs: {
        project_memory,
        prior_outputs: {
          translator: translator.envelope,
          designer: designer.envelope,
        },
        task: { hint: 'produce architectural guidance' },
      },
    })
    if (architect.status !== 'success') {
      return finalizeFailure({
        ...args, events, outputs, filesChanged: filesChangedSet, costTracker, trace,
        stoppedAt: 'architect', result: architect,
      })
    }
    outputs.architect = architect.envelope

    // V0.1 conflict-detected handling: surface and abort. (V1+ pauses
    // for user; V0.1 has no UI to pause to.)
    if (architect.envelope.status === 'conflict_detected') {
      return finalizeAbort({
        ...args, events, outputs, filesChanged: filesChangedSet, costTracker, trace,
        stoppedAt: 'architect',
        reason: 'Architect detected a conflict with project memory; iteration aborted (V0.1 has no user-pause UI yet — see ADR-005 / Layer H).',
      })
    }

    const coder = await invokeOne({
      role: 'coder',
      args,
      events,
      costTracker,
      ctx: baseCtx('coder'),
      promptInputs,
      envelopeInputs: {
        project_memory,
        prior_outputs: {
          translator: translator.envelope,
          designer: designer.envelope,
          architect: architect.envelope,
        },
        task: { hint: 'implement guidance' },
      },
    })
    if (coder.status !== 'success') {
      return finalizeFailure({
        ...args, events, outputs, filesChanged: filesChangedSet, costTracker, trace,
        stoppedAt: 'coder', result: coder,
      })
    }
    outputs.coder = coder.envelope
    captureFilesChanged(coder.envelope.payload as CoderPayload, filesChangedSet)

    // ─── Parallel: Adversary || Long-term Critic || Test Runner ──
    // We run them through invokeOne directly (rather than the
    // parallelReviewers helper) because invokeOne threads
    // providerFactory + cost tracker. parallelReviewers stays in the
    // module for use in tests / future refactors that pre-bind the
    // (provider, model) tuple.

    const [adv2, ltc2, tr2] = await Promise.all([
      invokeOne({
        role: 'adversary',
        args,
        events,
        costTracker,
        ctx: baseCtx('adversary'),
        promptInputs,
        envelopeInputs: {
          project_memory,
          prior_outputs: {
            translator: translator.envelope,
            designer: designer.envelope,
            architect: architect.envelope,
            coder: coder.envelope,
          },
          task: { hint: 'adversarial review' },
        },
      }),
      invokeOne({
        role: 'long_term_critic',
        args,
        events,
        costTracker,
        ctx: baseCtx('long_term_critic'),
        promptInputs,
        envelopeInputs: {
          project_memory,
          prior_outputs: {
            translator: translator.envelope,
            designer: designer.envelope,
            architect: architect.envelope,
            coder: coder.envelope,
          },
          task: { hint: 'long-term review' },
        },
      }),
      invokeOne({
        role: 'test_runner',
        args,
        events,
        costTracker,
        ctx: baseCtx('test_runner'),
        promptInputs,
        envelopeInputs: {
          project_memory,
          prior_outputs: {
            translator: translator.envelope,
            designer: designer.envelope,
            architect: architect.envelope,
            coder: coder.envelope,
          },
          task: { hint: 'write + run tests' },
        },
      }),
    ])

    // Persist successful envelopes; surface failures explicitly so
    // Communicator can't quietly invent content for missing roles.
    // (Smoke 6 expense-tracker incident: Adversary failed silently
    // and Communicator fabricated a "login rate-limiting" risk.)
    const reviewerFailures: Array<{ role: 'adversary' | 'long_term_critic' | 'test_runner'; reason: string; detail: string }> = []
    if (adv2.status === 'success') outputs.adversary = adv2.envelope
    else reviewerFailures.push({ role: 'adversary', reason: adv2.reason, detail: adv2.detail })
    if (ltc2.status === 'success') outputs.long_term_critic = ltc2.envelope
    else reviewerFailures.push({ role: 'long_term_critic', reason: ltc2.reason, detail: ltc2.detail })
    if (tr2.status === 'success') outputs.test_runner = tr2.envelope
    else reviewerFailures.push({ role: 'test_runner', reason: tr2.reason, detail: tr2.detail })

    for (const f of reviewerFailures) {
      // eslint-disable-next-line no-console
      console.warn(
        `[runIteration] reviewer ${f.role} FAILED — ${f.reason}: ${f.detail.slice(0, 240)}`,
      )
      events.emit({ type: 'role_failed', role: f.role, error: `${f.reason}: ${f.detail}` })
    }

    // If ALL three reviewers failed, that's a hard failure.
    if (
      adv2.status !== 'success' &&
      ltc2.status !== 'success' &&
      tr2.status !== 'success'
    ) {
      return finalizeFailure({
        ...args, events, outputs, filesChanged: filesChangedSet, costTracker, trace,
        stoppedAt: 'adversary', result: adv2,
      })
    }

    // ─── Conflict detection (pure) ─────────────────────────────

    const conflicts = detectConflicts({
      outputs,
      iteration_number: trace.iteration_number,
    })
    for (const c of conflicts) {
      events.emit({ type: 'conflict_detected', conflict: c })
    }

    // ─── Sequential: Communicator ──────────────────────────────

    const communicator = await invokeOne({
      role: 'communicator',
      args,
      events,
      costTracker,
      ctx: baseCtx('communicator'),
      promptInputs,
      envelopeInputs: {
        project_memory,
        prior_outputs: outputs,
        task: {
          conflicts,
          // Real stats from the orchestrator's metering. The
          // Communicator prompt §7.6 reads from here — without this
          // it would invent stats from prompt examples, which
          // happened in smoke 6 (fake "Claude-Opus-4-6 / $0.04 / 87s"
          // values copied straight from §10 example).
          stats: {
            total_cost_usd: Number(costTracker.iterationTotal().toFixed(4)),
            duration_seconds: Math.round(
              (Date.now() - trace.startedAt) / 1000,
            ),
            // role → model mapping for ONLY the roles whose envelopes
            // are present (i.e. actually ran successfully). Missing
            // roles must not appear here.
            models_by_role: Object.fromEntries(
              (Object.entries(outputs) as Array<
                [string, { model?: string } | undefined]
              >)
                .filter(([, e]) => e?.model)
                .map(([role, e]) => [role, e?.model]),
            ),
            // Convenience: distinct model names that participated.
            models_used: [
              ...new Set(
                Object.values(outputs)
                  .map((e) => e?.model)
                  .filter((m): m is string => !!m),
              ),
            ],
            // Reviewer roles whose envelopes are MISSING (they
            // failed or were skipped). Communicator must not
            // fabricate output for these.
            reviewers_missing: ['adversary', 'long_term_critic', 'test_runner']
              .filter((r) => !(r in outputs)),
          },
        },
        ui_lang: args.workspace.ui_lang,
      },
    })
    if (communicator.status !== 'success') {
      return finalizeFailure({
        ...args, events, outputs, filesChanged: filesChangedSet, costTracker, trace,
        stoppedAt: 'communicator', result: communicator,
      })
    }
    outputs.communicator = communicator.envelope

    // ─── Apply memory updates (only on successful completion) ──

    try {
      applyMemoryUpdates({
        db: args.db,
        workspace_id: args.workspace.id,
        iteration_number: trace.iteration_number,
        architect_payload: architect.envelope.payload as never,
      })
    } catch (e) {
      // Memory update failure is non-fatal — log but proceed.
      // eslint-disable-next-line no-console
      console.error('applyMemoryUpdates failed:', e)
    }

    const trafficLight: IterationTrafficLight =
      (communicator.envelope.payload as CommunicatorPayload).traffic_light ?? 'green'

    const completed: PipelineResultCompleted = {
      status: 'completed',
      iteration_id: trace.iteration_id,
      duration_ms: costTracker.iterationDuration(),
      total_cost_usd: costTracker.iterationTotal(),
      role_outputs: outputs,
      conflicts,
      files_changed: [...filesChangedSet],
      traffic_light: trafficLight,
    }

    finishIterationTrace({
      db: args.db,
      iteration_id: trace.iteration_id,
      workspace_id: args.workspace.id,
      status: 'completed',
      traffic_light: trafficLight,
      total_cost_usd: completed.total_cost_usd,
      files_changed: completed.files_changed,
      role_outputs: outputs,
      conflicts,
      cost_tracker: costTracker,
    })

    events.emit({ type: 'iteration_completed', result: completed })
    return completed
  } catch (e) {
    // Unhandled exception. Wrap into a failure result and persist.
    const err =
      e instanceof PipelineError
        ? e
        : new PipelineError(
            'unknown',
            null,
            e instanceof Error ? e.message : String(e),
            e,
          )

    const failed: PipelineResultFailed = {
      status: 'failed',
      iteration_id: trace.iteration_id,
      stopped_at_role: err.role ?? 'translator',
      error: err.message,
      error_code: err.code,
      partial_outputs: outputs,
      cost_so_far_usd: costTracker.iterationTotal(),
    }
    try {
      finishIterationTrace({
        db: args.db,
        iteration_id: trace.iteration_id,
        workspace_id: args.workspace.id,
        status: 'failed',
        traffic_light: null,
        total_cost_usd: costTracker.iterationTotal(),
        files_changed: [...filesChangedSet],
        role_outputs: outputs,
        conflicts: [],
        cost_tracker: costTracker,
      })
    } catch {
      // best-effort
    }
    events.emit({ type: 'iteration_failed', result: failed })
    return failed
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

type InvokeOneArgs = {
  role: RoleType
  args: RunIterationArgs
  events: PipelineEventBus
  costTracker: CostTracker
  ctx: ToolContext
  promptInputs: Parameters<typeof invokeRole>[0]['promptInputs']
  envelopeInputs: Parameters<typeof invokeRole>[0]['envelopeInputs']
}

async function invokeOne(io: InvokeOneArgs): Promise<InvokeRoleResult> {
  const { role, args, events, costTracker, ctx, promptInputs, envelopeInputs } = io

  const factoryStart = Date.now()
  const { provider, model } = await args.providerFactory(role)
  events.emit({ type: 'role_started', role, model })

  const start = Date.now()
  const result = await invokeRole({
    role,
    provider,
    model,
    ctx,
    promptInputs,
    envelopeInputs,
    onTokenChunk: (text_delta, accumulated_chars) => {
      events.emit({
        type: 'role_token_chunk',
        role,
        text_delta,
        accumulated_chars,
      })
    },
  })
  const duration_ms = Date.now() - start + (start - factoryStart)

  if (result.status === 'success') {
    costTracker.record({
      role,
      provider: provider.id,
      model,
      usage: {
        input_tokens: result.totalUsage.input_tokens,
        output_tokens: result.totalUsage.output_tokens,
        cached_input_tokens: result.totalUsage.cached_input_tokens,
        total_tokens:
          result.totalUsage.input_tokens + result.totalUsage.output_tokens,
        estimated_cost_usd: result.totalUsage.estimated_cost_usd,
      },
      duration_ms,
    })
    events.emit({ type: 'role_completed', role, envelope: result.envelope })
  } else {
    events.emit({ type: 'role_failed', role, error: result.detail })
  }
  return result
}

function captureFilesChanged(coder: CoderPayload, set: Set<string>): void {
  for (const f of coder.files_changed ?? []) {
    set.add(f.path)
  }
}

type FinalizeArgs = RunIterationArgs & {
  events: PipelineEventBus
  outputs: Partial<Record<RoleType, RoleOutputEnvelope>>
  filesChanged: Set<string>
  costTracker: CostTracker
  trace: { iteration_id: string; iteration_number: number }
  stoppedAt: RoleType
  result?: InvokeRoleResult
  reason?: string
}

function finalizeFailure(args: FinalizeArgs): PipelineResultFailed {
  const result = args.result
  const errorCode =
    result && result.status === 'failure' ? result.reason : 'unknown'
  const errorDetail =
    result && result.status === 'failure' ? result.detail : 'unknown failure'

  const failed: PipelineResultFailed = {
    status: 'failed',
    iteration_id: args.trace.iteration_id,
    stopped_at_role: args.stoppedAt,
    error: errorDetail,
    error_code: errorCode,
    partial_outputs: args.outputs,
    cost_so_far_usd: args.costTracker.iterationTotal(),
  }

  try {
    finishIterationTrace({
      db: args.db,
      iteration_id: args.trace.iteration_id,
      workspace_id: args.workspace.id,
      status: 'failed',
      traffic_light: null,
      total_cost_usd: args.costTracker.iterationTotal(),
      files_changed: [...args.filesChanged],
      role_outputs: args.outputs,
      conflicts: [],
      cost_tracker: args.costTracker,
    })
  } catch {
    // best-effort
  }
  args.events.emit({ type: 'iteration_failed', result: failed })
  return failed
}

function finalizeAbort(args: FinalizeArgs): PipelineResultAborted {
  const aborted: PipelineResultAborted = {
    status: 'aborted',
    iteration_id: args.trace.iteration_id,
    stopped_at_role: args.stoppedAt,
    reason: args.reason ?? 'aborted',
    partial_outputs: args.outputs,
    cost_so_far_usd: args.costTracker.iterationTotal(),
  }

  try {
    finishIterationTrace({
      db: args.db,
      iteration_id: args.trace.iteration_id,
      workspace_id: args.workspace.id,
      status: 'aborted',
      traffic_light: null,
      total_cost_usd: args.costTracker.iterationTotal(),
      files_changed: [...args.filesChanged],
      role_outputs: args.outputs,
      conflicts: [],
      cost_tracker: args.costTracker,
    })
  } catch {
    // best-effort
  }
  args.events.emit({ type: 'iteration_aborted', result: aborted })
  return aborted
}

