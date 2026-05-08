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
