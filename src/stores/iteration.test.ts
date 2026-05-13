// Tests the reducer in isolation. The Zustand store wiring +
// IPC subscription aren't tested here (would need a full Electron
// runtime); the reducer is pure and that's where the logic lives.

import { describe, it, expect } from 'vitest'
import { _testReduceEvent } from './iteration.js'
import type {
  IterationState,
  RoleProgress,
  IterationStateStatus,
} from './iteration.js'
import type { RoleType } from '@core/types/role.js'

const ALL_ROLES: RoleType[] = [
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
]

function emptyState(): IterationState {
  const roleProgress = {} as Record<RoleType, RoleProgress>
  for (const r of ALL_ROLES) roleProgress[r] = { role: r, status: 'idle' }
  return {
    status: 'idle',
    mode: 'full',
    iteration_id: null,
    iteration_number: null,
    user_prompt: null,
    roleProgress,
    cumulativeCostUsd: 0,
    conflicts: 0,
    toolCallLog: [],
    result: null,
    error: null,
  }
}

function applyEvents(
  initial: IterationState,
  events: Array<Parameters<typeof _testReduceEvent>[2]>,
): IterationState {
  let state = initial
  const set = (partial: Partial<IterationState>) => {
    state = { ...state, ...partial }
  }
  for (const e of events) {
    _testReduceEvent(state, set as never, e)
  }
  return state
}

describe('iteration reducer', () => {
  it('iteration_started seeds state from idle', () => {
    const s = applyEvents(emptyState(), [
      {
        type: 'iteration_started',
        iteration_id: 'i-1',
        user_prompt: 'go',
        workspace_id: 'ws-1',
      } as never,
    ])
    expect(s.status).toBe('running' satisfies IterationStateStatus)
    expect(s.iteration_id).toBe('i-1')
    expect(s.user_prompt).toBe('go')
  })

  it('role_started → role_completed updates the progress map', () => {
    const s = applyEvents(emptyState(), [
      {
        type: 'iteration_started',
        iteration_id: 'i-1',
        user_prompt: 'p',
        workspace_id: 'ws',
      } as never,
      {
        type: 'role_started',
        role: 'translator',
        model: 'deepseek-chat',
        workspace_id: 'ws',
        iteration_id: 'i-1',
      } as never,
      {
        type: 'role_completed',
        role: 'translator',
        envelope: {
          role: 'translator',
          iteration: 1,
          model: 'm',
          status: 'ok',
          summary: 's',
          payload: {},
        },
        workspace_id: 'ws',
        iteration_id: 'i-1',
      } as never,
    ])
    expect(s.roleProgress.translator.status).toBe('completed')
    expect(s.roleProgress.translator.model).toBe('deepseek-chat')
    expect(s.roleProgress.translator.envelopeStatus).toBe('ok')
  })

  it('role_failed sets failed status + errorDetail', () => {
    const s = applyEvents(emptyState(), [
      {
        type: 'role_failed',
        role: 'coder',
        error: 'envelope_parse_exhausted',
        workspace_id: 'ws',
        iteration_id: 'i-1',
      } as never,
    ])
    expect(s.roleProgress.coder.status).toBe('failed')
    expect(s.roleProgress.coder.errorDetail).toBe('envelope_parse_exhausted')
  })

  it('cost_update accumulates', () => {
    const s = applyEvents(emptyState(), [
      { type: 'cost_update', cumulative_usd: 0.005, workspace_id: 'ws', iteration_id: 'i' } as never,
      { type: 'cost_update', cumulative_usd: 0.012, workspace_id: 'ws', iteration_id: 'i' } as never,
    ])
    // Last value wins (the orchestrator emits cumulative, not deltas).
    expect(s.cumulativeCostUsd).toBe(0.012)
  })

  it('conflict_detected increments counter', () => {
    const s = applyEvents(emptyState(), [
      {
        type: 'conflict_detected',
        conflict: {
          id: 'C-1',
          type: 'adversary_flagged_test_passed',
          involved_roles: ['adversary', 'test_runner'],
          severity: 'high',
          description: '...',
          user_action_required: true,
        },
        workspace_id: 'ws',
        iteration_id: 'i',
      } as never,
      {
        type: 'conflict_detected',
        conflict: {
          id: 'C-2',
          type: 'critic_warns_coder_proceeds',
          involved_roles: ['long_term_critic', 'coder'],
          severity: 'medium',
          description: '...',
          user_action_required: false,
        },
        workspace_id: 'ws',
        iteration_id: 'i',
      } as never,
    ])
    expect(s.conflicts).toBe(2)
  })

  it('iteration_completed transitions to status:completed', () => {
    const s = applyEvents(emptyState(), [
      {
        type: 'iteration_completed',
        result: {
          status: 'completed',
          iteration_id: 'i-1',
          duration_ms: 0,
          total_cost_usd: 0,
          role_outputs: {},
          conflicts: [],
          files_changed: [],
          traffic_light: 'green',
        },
        workspace_id: 'ws',
        iteration_id: 'i-1',
      } as never,
    ])
    expect(s.status).toBe('completed')
    expect(s.result?.status).toBe('completed')
  })

  it('iteration_failed transitions to status:failed and surfaces error', () => {
    const s = applyEvents(emptyState(), [
      {
        type: 'iteration_failed',
        result: {
          status: 'failed',
          iteration_id: 'i-1',
          stopped_at_role: 'translator',
          error: 'envelope_parse_exhausted: ...',
          error_code: 'envelope_parse_exhausted',
          partial_outputs: {},
          cost_so_far_usd: 0,
        },
        workspace_id: 'ws',
        iteration_id: 'i-1',
      } as never,
    ])
    expect(s.status).toBe('failed')
    expect(s.error).toContain('envelope_parse_exhausted')
  })
})
