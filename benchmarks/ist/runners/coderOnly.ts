// IST control variant. Runs only the Coder role against the user
// prompt — no Translator/Designer/Architect upstream, no Adversary/
// Long-term Critic/Test Runner downstream, no Communicator.
// Per docs/decisions.md ADR-016.
//
// Returns a PipelineResult-shaped object so the IST runner can
// serialize coder-only and full results uniformly.

import type Database from 'better-sqlite3'

import type { ToolContext } from '@tools/ToolDef.js'
import type { KeyStore } from '../../../electron/secrets/keystore.js'
import type { Workspace } from '@core/types/workspace.js'
import type { PipelineResult } from '@core/types/iteration.js'
import type { CoderPayload } from '@core/types/payloads/coder.js'
import type { ProviderFactory } from '@core/orchestrator/runIteration.js'

import { invokeRole } from '@core/roleHarness/invokeRole.js'
import { CostTracker } from '@core/orchestrator/CostTracker.js'
import {
  startIterationTrace,
  finishIterationTrace,
} from '@core/orchestrator/iterationTrace.js'
import { getProjectMemory } from '../../../data/projectMemory.js'

export type RunCoderOnlyArgs = {
  db: Database.Database
  keystore: KeyStore
  workspace: Workspace
  user_prompt: string
  providerFactory: ProviderFactory
  abort_signal?: AbortSignal
}

export async function runCoderOnly(
  args: RunCoderOnlyArgs,
): Promise<PipelineResult> {
  const { db, keystore, workspace, user_prompt, providerFactory } = args
  const abort = args.abort_signal ?? new AbortController().signal
  const start = Date.now()

  const trace = startIterationTrace({
    db,
    workspace_id: workspace.id,
    user_prompt,
  })

  const costTracker = new CostTracker()
  const project_memory = getProjectMemory(db, workspace.id)

  const ctx: ToolContext = {
    workspace_id: workspace.id,
    workspace_root: workspace.workspace_root,
    iteration_id: trace.iteration_id,
    role: 'coder',
    abort_signal: abort,
    emit_event: () => {},
    db,
    keystore,
    read_files_in_iteration: new Set<string>(),
    iteration_number: trace.iteration_number,
  }

  const promptInputs = {
    workspace_name: workspace.name,
    iteration_number: trace.iteration_number,
    project_memory,
    total_iterations: Math.max(0, trace.iteration_number - 1),
  }

  const factoryStart = Date.now()
  const { provider, model } = await providerFactory('coder')
  const invokeStart = Date.now()

  const result = await invokeRole({
    role: 'coder',
    provider,
    model,
    ctx,
    promptInputs,
    envelopeInputs: {
      project_memory,
      task: user_prompt,
    },
  })

  const duration_ms = Date.now() - invokeStart + (invokeStart - factoryStart)

  if (result.status === 'success') {
    costTracker.record({
      role: 'coder',
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

    const filesChanged = collectFilesChanged(
      result.envelope.payload as CoderPayload,
    )

    finishIterationTrace({
      db,
      iteration_id: trace.iteration_id,
      workspace_id: workspace.id,
      status: 'completed',
      traffic_light: 'green',
      total_cost_usd: costTracker.iterationTotal(),
      files_changed: [...filesChanged],
      role_outputs: { coder: result.envelope },
      conflicts: [],
      cost_tracker: costTracker,
    })

    return {
      status: 'completed',
      iteration_id: trace.iteration_id,
      duration_ms: Date.now() - start,
      total_cost_usd: costTracker.iterationTotal(),
      role_outputs: { coder: result.envelope },
      conflicts: [],
      files_changed: [...filesChanged],
      traffic_light: 'green',
    }
  }

  finishIterationTrace({
    db,
    iteration_id: trace.iteration_id,
    workspace_id: workspace.id,
    status: 'failed',
    traffic_light: 'red',
    total_cost_usd: costTracker.iterationTotal(),
    files_changed: [],
    role_outputs: {},
    conflicts: [],
    cost_tracker: costTracker,
  })

  return {
    status: 'failed',
    iteration_id: trace.iteration_id,
    stopped_at_role: 'coder',
    error: result.detail,
    error_code: result.reason,
    partial_outputs: {},
    cost_so_far_usd: costTracker.iterationTotal(),
  }
}

function collectFilesChanged(coder: CoderPayload): Set<string> {
  const set = new Set<string>()
  for (const f of coder.files_changed ?? []) {
    set.add(f.path)
  }
  return set
}
