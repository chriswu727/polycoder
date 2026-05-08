import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { aggregateMetrics } from './aggregate.js'
import type { IterMetrics } from '../metrics/types.js'

let metricsRoot: string

beforeEach(() => {
  metricsRoot = mkdtempSync(join(tmpdir(), 'agg-'))
})
afterEach(() => {
  rmSync(metricsRoot, { recursive: true, force: true })
})

function writeMetric(
  system: string,
  template: string,
  iter: number,
  partial: {
    bpr?: 'pass' | 'fail' | 'na'
    spr?: 'pass' | 'fail' | 'na'
    tcmr?: 'pass' | 'fail' | 'na'
    ccd_mean?: number | null
    ccd_drift?: number | null
    tcmr_applicable?: boolean
  },
): void {
  const dir = join(metricsRoot, system, template)
  mkdirSync(dir, { recursive: true })
  const m: IterMetrics = {
    cell: { system, template, iter: iter as 1 },
    computed_at: new Date().toISOString(),
    build_pass_rate: {
      status: partial.bpr ?? 'pass',
      applicable: true,
      applicable_reason: '',
      build_kind: 'static',
      exit_code: 0,
      duration_ms: 0,
      served_dir: '/x',
    },
    smoke_pass_rate: {
      status: partial.spr ?? 'pass',
      applicable: true,
      applicable_reason: '',
      console_errors: [],
      golden_captured: null,
      persistence_check: null,
      duration_ms: 0,
    },
    test_coverage_maintenance: {
      status: partial.tcmr ?? 'na',
      applicable: partial.tcmr_applicable ?? false,
      applicable_reason: '',
      test_command: null,
      exit_code: null,
      duration_ms: 0,
    },
    complexity_drift: {
      status: 'pass',
      applicable: true,
      applicable_reason: '',
      files_analyzed: 1,
      mean_complexity: partial.ccd_mean ?? 1,
      max_complexity: partial.ccd_mean ?? 1,
      drift_from_iter1: partial.ccd_drift ?? null,
      duration_ms: 0,
    },
  }
  writeFileSync(join(dir, `iter${iter.toString().padStart(2, '0')}.json`), JSON.stringify(m))
}

describe('aggregateMetrics', () => {
  it('returns warnings for missing cells', () => {
    const out = aggregateMetrics({
      metrics_root: metricsRoot,
      systems: ['polycoder-full', 'lovable'],
      templates: ['todo'],
    })
    expect(out.results.warnings.length).toBeGreaterThanOrEqual(2)
    expect(out.results.cells).toHaveLength(2)
    expect(out.results.cells.every((c) => c.iters_present.length === 0)).toBe(true)
  })

  it('computes pass rates correctly', () => {
    writeMetric('polycoder-full', 'todo', 1, { bpr: 'pass', spr: 'pass' })
    writeMetric('polycoder-full', 'todo', 2, { bpr: 'pass', spr: 'fail' })
    writeMetric('polycoder-full', 'todo', 3, { bpr: 'fail', spr: 'na' })
    writeMetric('polycoder-full', 'todo', 4, { bpr: 'pass', spr: 'pass' })
    writeMetric('polycoder-full', 'todo', 5, { bpr: 'pass', spr: 'pass' })

    const out = aggregateMetrics({
      metrics_root: metricsRoot,
      systems: ['polycoder-full'],
      templates: ['todo'],
    })
    const cell = out.results.cells[0]!
    expect(cell.iters_present).toEqual([1, 2, 3, 4, 5])
    expect(cell.bpr_pass_rate).toBeCloseTo(0.8, 2) // 4/5
    expect(cell.spr_pass_rate).toBeCloseTo(0.75, 2) // 3 applicable, 3 pass... wait
    // SPR applicable: 1,2,4,5 (status na excluded). 1 fail among those.
    // 4 applicable, 3 pass → 0.75
  })

  it('counts breaks (BPR fail OR SPR fail) and longest run', () => {
    writeMetric('polycoder-full', 'todo', 1, { bpr: 'pass', spr: 'pass' })
    writeMetric('polycoder-full', 'todo', 2, { bpr: 'fail', spr: 'na' })
    writeMetric('polycoder-full', 'todo', 3, { bpr: 'fail', spr: 'na' })
    writeMetric('polycoder-full', 'todo', 4, { bpr: 'pass', spr: 'fail' })
    writeMetric('polycoder-full', 'todo', 5, { bpr: 'pass', spr: 'pass' })

    const out = aggregateMetrics({
      metrics_root: metricsRoot,
      systems: ['polycoder-full'],
      templates: ['todo'],
    })
    const cell = out.results.cells[0]!
    expect(cell.break_count).toBe(3)
    expect(cell.longest_break_run).toBe(3) // iters 2-3 (BPR fail) + iter 4 (SPR fail)
  })

  it('captures CCD drift at iter 5', () => {
    writeMetric('polycoder-full', 'todo', 1, { ccd_mean: 1.5 })
    writeMetric('polycoder-full', 'todo', 5, { ccd_mean: 3.0, ccd_drift: 1.5 })

    const out = aggregateMetrics({
      metrics_root: metricsRoot,
      systems: ['polycoder-full'],
      templates: ['todo'],
    })
    const cell = out.results.cells[0]!
    expect(cell.ccd_mean_iter1).toBe(1.5)
    expect(cell.ccd_mean_iter5).toBe(3.0)
    expect(cell.ccd_drift_iter5).toBe(1.5)
  })

  it('combines per-cell rates into per-system rates weighted by iter count', () => {
    // todo: 5 iters, bpr=1.0
    for (let i = 1; i <= 5; i++) {
      writeMetric('polycoder-full', 'todo', i, { bpr: 'pass' })
    }
    // dashboard: 2 iters, bpr=0.5
    writeMetric('polycoder-full', 'dashboard', 1, { bpr: 'pass' })
    writeMetric('polycoder-full', 'dashboard', 2, { bpr: 'fail' })

    const out = aggregateMetrics({
      metrics_root: metricsRoot,
      systems: ['polycoder-full'],
      templates: ['todo', 'dashboard'],
    })
    const sys = out.results.systems[0]!
    // (5*1 + 2*0.5) / 7 = 6/7 ≈ 0.857
    expect(sys.bpr_pass_rate).toBeCloseTo(0.857, 2)
  })

  it('captures notes for failures in raw records', () => {
    writeMetric('polycoder-full', 'todo', 1, { bpr: 'fail' })

    const out = aggregateMetrics({
      metrics_root: metricsRoot,
      systems: ['polycoder-full'],
      templates: ['todo'],
    })
    expect(out.raw[0]!.bpr_status).toBe('fail')
    expect(out.raw[0]!.notes.some((n) => /build/.test(n))).toBe(true)
  })
})
