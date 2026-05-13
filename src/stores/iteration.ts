// Iteration store — current pipeline run state + history.
// Subscribes to window.polycoder.iteration.onEvent and reduces
// streamed events into per-role progress + final result.

import { create } from 'zustand'
import type { RoleType } from '@core/types/role.js'
import type {
  PipelineResultCompleted,
  PipelineResultAborted,
  PipelineResultFailed,
} from '@core/types/iteration.js'
import type { RendererPipelineEvent } from '@/../electron/ipc/pipelineHandlers.js'

export type RoleProgressStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'retried'
  | 'skipped'

export type RoleProgress = {
  role: RoleType
  status: RoleProgressStatus
  model?: string
  attempts?: number
  retryReason?: string
  envelopeStatus?: string
  errorDetail?: string
}

export type IterationStateStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'aborted'
  | 'failed'

export type IterationState = {
  status: IterationStateStatus
  iteration_id: string | null
  iteration_number: number | null
  user_prompt: string | null
  roleProgress: Record<RoleType, RoleProgress>
  cumulativeCostUsd: number
  conflicts: number
  result: PipelineResultCompleted | PipelineResultAborted | PipelineResultFailed | null
  error: string | null
}

type IterationStore = IterationState & {
  start: (workspace_id: string, prompt: string) => Promise<void>
  abort: (workspace_id: string) => Promise<void>
  reset: () => void
  /** Load a past iteration from the DB into the store. Renders in
   *  the right pane same as a freshly-completed iter. */
  loadPast: (iteration_id: string) => Promise<void>
  /** Wire the IPC subscription. Call once at app start. */
  bootstrap: (currentWorkspaceId: () => string | null) => () => void
}

const ALL_ROLE_TYPES: RoleType[] = [
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
]

function emptyRoleProgress(): Record<RoleType, RoleProgress> {
  const out = {} as Record<RoleType, RoleProgress>
  for (const r of ALL_ROLE_TYPES) {
    out[r] = { role: r, status: 'idle' }
  }
  return out
}

function initial(): IterationState {
  return {
    status: 'idle',
    iteration_id: null,
    iteration_number: null,
    user_prompt: null,
    roleProgress: emptyRoleProgress(),
    cumulativeCostUsd: 0,
    conflicts: 0,
    result: null,
    error: null,
  }
}

export const useIterationStore = create<IterationStore>((set, get) => ({
  ...initial(),

  reset() {
    set(initial())
  },

  async start(workspace_id, prompt) {
    set({
      ...initial(),
      status: 'running',
      user_prompt: prompt,
    })
    const ack = await window.polycoder.iteration.start({
      workspace_id,
      user_prompt: prompt,
    })
    if (!ack.ok) {
      set({ status: 'failed', error: ack.error })
      return
    }
    set({ iteration_id: ack.iteration_id, iteration_number: ack.iteration_number })
  },

  async abort(workspace_id) {
    await window.polycoder.iteration.abort({ workspace_id })
  },

  async loadPast(iteration_id) {
    const res = await window.polycoder.iteration.get({ iteration_id })
    if (!res.ok) {
      set({
        ...initial(),
        status: 'failed',
        error: res.error,
      })
      return
    }
    const r = res.record
    if (!r) {
      // Shouldn't happen — IPC handler returns ok:false in that case.
      set({ ...initial(), status: 'failed', error: 'record missing' })
      return
    }
    let roleOutputs: Partial<Record<RoleType, unknown>> = {}
    try {
      roleOutputs = JSON.parse(r.role_outputs_json) as Partial<
        Record<RoleType, unknown>
      >
    } catch {
      // Bad data; render with empty outputs. The Communicator
      // block in the right pane will simply not show.
    }
    let conflicts: unknown[] = []
    try {
      conflicts = JSON.parse(r.conflicts_json) as unknown[]
    } catch {
      conflicts = []
    }

    // Synthesize a result object that matches the shape the right
    // pane already renders.
    if (r.status === 'completed' && r.traffic_light) {
      const completed: PipelineResultCompleted = {
        status: 'completed',
        iteration_id: r.id,
        duration_ms: r.duration_ms ?? 0,
        total_cost_usd: r.total_cost_usd ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        role_outputs: roleOutputs as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conflicts: conflicts as any,
        files_changed: r.files_changed,
        traffic_light: r.traffic_light,
      }
      const next = emptyRoleProgress()
      for (const role of ALL_ROLE_TYPES) {
        const env = (roleOutputs as Record<string, unknown>)[role] as
          | { model?: string }
          | undefined
        if (env) {
          next[role] = {
            role,
            status: 'completed',
            ...(env.model !== undefined ? { model: env.model } : {}),
          }
        }
      }
      set({
        ...initial(),
        status: 'completed',
        iteration_id: r.id,
        iteration_number: r.iteration_number,
        user_prompt: r.user_prompt,
        roleProgress: next,
        cumulativeCostUsd: r.total_cost_usd ?? 0,
        result: completed,
      })
    } else if (r.status === 'failed') {
      // We don't have the stopped-at-role recorded directly; pick
      // the last "running" role from the role_outputs map, fall
      // back to 'coder' if absent.
      const stoppedAt: RoleType =
        ALL_ROLE_TYPES.find(
          (rt) => !(rt in (roleOutputs as Record<string, unknown>)),
        ) ?? 'coder'
      const failed: PipelineResultFailed = {
        status: 'failed',
        iteration_id: r.id,
        stopped_at_role: stoppedAt,
        error: 'historical iteration — see DB for details',
        error_code: 'role_max_attempts_exceeded',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        partial_outputs: roleOutputs as any,
        cost_so_far_usd: r.total_cost_usd ?? 0,
      }
      set({
        ...initial(),
        status: 'failed',
        iteration_id: r.id,
        iteration_number: r.iteration_number,
        user_prompt: r.user_prompt,
        cumulativeCostUsd: r.total_cost_usd ?? 0,
        result: failed,
        error: failed.error,
      })
    } else {
      // running / aborted / other — show as idle with the prompt visible
      set({
        ...initial(),
        iteration_number: r.iteration_number,
        user_prompt: r.user_prompt,
      })
    }
  },

  bootstrap(currentWorkspaceId) {
    const off = window.polycoder.iteration.onEvent((event) => {
      // Filter by workspace — the store represents only the active
      // workspace's iteration. Events for other workspaces are ignored.
      const expected = currentWorkspaceId()
      if (expected && event.workspace_id !== expected) return

      reduceEvent(get(), set, event)
    })
    return off
  },
}))

// ─── Reducer ────────────────────────────────────────────────────────

function reduceEvent(
  state: IterationState,
  set: (partial: Partial<IterationStore>) => void,
  event: RendererPipelineEvent,
): void {
  switch (event.type) {
    case 'iteration_started': {
      set({
        status: 'running',
        iteration_id: event.iteration_id,
        user_prompt: event.user_prompt,
        roleProgress: emptyRoleProgress(),
        cumulativeCostUsd: 0,
        conflicts: 0,
        result: null,
        error: null,
      })
      return
    }
    case 'role_started': {
      const next = { ...state.roleProgress }
      next[event.role] = {
        ...next[event.role],
        status: 'running',
        model: event.model,
      }
      set({ roleProgress: next })
      return
    }
    case 'role_completed': {
      const next = { ...state.roleProgress }
      next[event.role] = {
        ...next[event.role],
        status: 'completed',
        envelopeStatus: event.envelope.status,
      }
      set({ roleProgress: next })
      return
    }
    case 'role_failed': {
      const next = { ...state.roleProgress }
      next[event.role] = {
        ...next[event.role],
        status: 'failed',
        errorDetail: event.error,
      }
      set({ roleProgress: next })
      return
    }
    case 'role_retried': {
      const next = { ...state.roleProgress }
      next[event.role] = {
        ...next[event.role],
        status: 'retried',
        attempts: event.attempt,
        retryReason: event.reason,
      }
      set({ roleProgress: next })
      return
    }
    case 'cost_update': {
      set({ cumulativeCostUsd: event.cumulative_usd })
      return
    }
    case 'conflict_detected': {
      set({ conflicts: state.conflicts + 1 })
      return
    }
    case 'iteration_completed': {
      set({
        status: 'completed',
        result: event.result,
      })
      return
    }
    case 'iteration_aborted': {
      set({
        status: 'aborted',
        result: event.result,
      })
      return
    }
    case 'iteration_failed': {
      set({
        status: 'failed',
        result: event.result,
        error: event.result.error,
      })
      return
    }
    case 'awaiting_user':
    case 'user_responded':
      // V0.1: not reachable yet (no UI to ask user mid-iteration).
      return
  }
}

// Exported for test purposes; not part of the public store.
export const _testReduceEvent = reduceEvent
export const _ALL_ROLES_FOR_TESTS: readonly RoleType[] = ALL_ROLE_TYPES
