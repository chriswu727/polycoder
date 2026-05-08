import { describe, it, expect } from 'vitest'
import { PipelineError } from './PipelineError.js'
import { CostTracker } from './CostTracker.js'
import { PipelineEventBus } from './events.js'

describe('PipelineError', () => {
  it('captures code, role, message, detail', () => {
    const e = new PipelineError(
      'role_invocation_failed',
      'coder',
      'Coder retry exhausted',
      { attempts: 3 },
    )
    expect(e.code).toBe('role_invocation_failed')
    expect(e.role).toBe('coder')
    expect(e.message).toBe('Coder retry exhausted')
    expect(e.detail).toEqual({ attempts: 3 })
  })
})

describe('CostTracker', () => {
  it('aggregates per-role and per-model totals', () => {
    const t = new CostTracker()
    t.record({
      role: 'translator',
      provider: 'deepseek',
      model: 'deepseek-chat',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 0,
        total_tokens: 150,
        estimated_cost_usd: 0.001,
      },
      duration_ms: 500,
    })
    t.record({
      role: 'coder',
      provider: 'deepseek',
      model: 'deepseek-coder',
      usage: {
        input_tokens: 200,
        output_tokens: 800,
        cached_input_tokens: 0,
        total_tokens: 1000,
        estimated_cost_usd: 0.005,
      },
      duration_ms: 4000,
    })

    expect(t.iterationTotal()).toBeCloseTo(0.006, 6)
    expect(t.iterationDuration()).toBe(4500)
    expect(t.perRoleTotals().get('translator')).toBeCloseTo(0.001, 6)
    expect(t.perRoleTotals().get('coder')).toBeCloseTo(0.005, 6)
    expect(t.perModelTotals().get('deepseek-coder')).toBeCloseTo(0.005, 6)
  })

  it('iterationTotal is 0 with no entries', () => {
    const t = new CostTracker()
    expect(t.iterationTotal()).toBe(0)
    expect(t.iterationDuration()).toBe(0)
  })

  it('snapshot returns immutable copy', () => {
    const t = new CostTracker()
    t.record({
      role: 'communicator',
      provider: 'glm',
      model: 'glm-4-flash',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
      },
      duration_ms: 100,
    })
    const snap = t.snapshot()
    expect(snap.length).toBe(1)
  })
})

describe('PipelineEventBus', () => {
  it('delivers emitted events to all subscribers', () => {
    const bus = new PipelineEventBus()
    const a: unknown[] = []
    const b: unknown[] = []
    bus.subscribe((e) => a.push(e))
    bus.subscribe((e) => b.push(e))
    bus.emit({ type: 'iteration_started', iteration_id: 'i1', user_prompt: 'go' })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('unsubscribe stops further deliveries', () => {
    const bus = new PipelineEventBus()
    let count = 0
    const off = bus.subscribe(() => count++)
    bus.emit({ type: 'iteration_started', iteration_id: 'i1', user_prompt: 'go' })
    off()
    bus.emit({ type: 'iteration_started', iteration_id: 'i1', user_prompt: 'go' })
    expect(count).toBe(1)
  })

  it('a throwing listener does not break other listeners', () => {
    const bus = new PipelineEventBus()
    const calls: string[] = []
    bus.subscribe(() => {
      throw new Error('boom')
    })
    bus.subscribe(() => calls.push('ok'))
    bus.emit({ type: 'cost_update', cumulative_usd: 0.5 })
    expect(calls).toEqual(['ok'])
  })
})
