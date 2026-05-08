import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runMetrics } from './runMetrics.js'

let snapRoot: string
let metricsRoot: string

beforeEach(() => {
  snapRoot = mkdtempSync(join(tmpdir(), 'rm-snap-'))
  metricsRoot = mkdtempSync(join(tmpdir(), 'rm-metrics-'))
})
afterEach(() => {
  rmSync(snapRoot, { recursive: true, force: true })
  rmSync(metricsRoot, { recursive: true, force: true })
})

describe('runMetrics — composes 4 metrics for a static iter', () => {
  it('writes IterMetrics and reports BPR pass on a static snapshot', async () => {
    writeFileSync(
      join(snapRoot, 'index.html'),
      '<html><body><h1>hi</h1></body></html>',
    )
    writeFileSync(
      join(snapRoot, 'app.js'),
      'function add(a, b) { return a + b; }',
    )

    const r = await runMetrics({
      system: 'polycoder-coder-only',
      template: 'todo',
      iter: 1,
      snapshot_dir: snapRoot,
      metrics_dir: metricsRoot,
      include_spr: false,
      include_tcmr: false,
    })

    expect(r.metrics.build_pass_rate.status).toBe('pass')
    expect(r.metrics.build_pass_rate.build_kind).toBe('static')
    expect(r.metrics.smoke_pass_rate.status).toBe('na') // SPR off
    expect(r.metrics.test_coverage_maintenance.status).toBe('na') // TCMR off
    expect(r.metrics.complexity_drift.applicable).toBe(true)
    expect(r.metrics.complexity_drift.mean_complexity).toBe(1)

    expect(existsSync(r.metrics_path)).toBe(true)
    const written = JSON.parse(readFileSync(r.metrics_path, 'utf8')) as typeof r.metrics
    expect(written.cell.iter).toBe(1)
  })

  it('computes drift_from_iter1 once iter 1 metrics exist', async () => {
    // iter 1: simple linear function (mean = 1)
    writeFileSync(
      join(snapRoot, 'index.html'),
      '<html></html>',
    )
    writeFileSync(join(snapRoot, 'a.js'), 'function f() { return 1; }')

    await runMetrics({
      system: 'polycoder-coder-only',
      template: 'todo',
      iter: 1,
      snapshot_dir: snapRoot,
      metrics_dir: metricsRoot,
      include_spr: false,
      include_tcmr: false,
    })

    // iter 2: branchy function (mean > 1)
    const snap2 = mkdtempSync(join(tmpdir(), 'rm-snap2-'))
    try {
      writeFileSync(join(snap2, 'index.html'), '<html></html>')
      writeFileSync(
        join(snap2, 'a.js'),
        `
function classify(n) {
  if (n < 0) return 'neg';
  if (n === 0) return 'zero';
  if (n < 10) return 'small';
  if (n < 100) return 'med';
  return 'big';
}
        `,
      )

      const r2 = await runMetrics({
        system: 'polycoder-coder-only',
        template: 'todo',
        iter: 2,
        snapshot_dir: snap2,
        metrics_dir: metricsRoot,
        include_spr: false,
        include_tcmr: false,
      })

      expect(r2.metrics.complexity_drift.mean_complexity).toBeGreaterThan(1)
      expect(r2.metrics.complexity_drift.drift_from_iter1).toBeGreaterThan(0)
    } finally {
      rmSync(snap2, { recursive: true, force: true })
    }
  })

  it('throws when snapshot_dir missing', async () => {
    await expect(
      runMetrics({
        system: 'polycoder-full',
        template: 'todo',
        iter: 1,
        snapshot_dir: '/no/such/dir',
        metrics_dir: metricsRoot,
        include_spr: false,
        include_tcmr: false,
      }),
    ).rejects.toThrow(/snapshot_dir/)
  })
})
