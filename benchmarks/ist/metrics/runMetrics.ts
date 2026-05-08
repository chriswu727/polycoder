// Per-cell metrics orchestration. Calls the 4 metric helpers in
// the right order, threads results between them (BPR's served_dir
// → SPR; iter 1's golden → iter 2's prior_golden; iter 1's mean
// complexity → iter N's drift_from_iter1), and returns the
// composed IterMetrics record.
//
// File operations:
//   - Reads:  benchmarks/ist/runs/<system>/<template>/snapshots/iter<NN>/
//   - Writes: benchmarks/ist/metrics/<system>/<template>/iter<NN>.json
//             benchmarks/ist/metrics/<system>/<template>/golden/iter<NN>.json

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'

import { computeBPR } from './buildPassRate.js'
import { computeCCD } from './complexityDrift.js'
import { computeTCMR } from './coverageMaintenance.js'
import { computeSPR, type SPRGolden } from './smokePassRate.js'
import type { IterMetrics, CCD } from './types.js'

export type RunMetricsArgs = {
  system: string
  template: string
  iter: number
  /** Snapshot dir from the IST runner. */
  snapshot_dir: string
  /** Where to write metrics + golden output. */
  metrics_dir: string
  /** If true, run SPR (which needs Playwright Chromium). */
  include_spr: boolean
  /** If true, run TCMR (only meaningful for systems that produce tests). */
  include_tcmr: boolean
}

export type RunMetricsResult = {
  metrics: IterMetrics
  metrics_path: string
  golden_path: string
}

export async function runMetrics(args: RunMetricsArgs): Promise<RunMetricsResult> {
  if (!existsSync(args.snapshot_dir)) {
    throw new Error(`runMetrics: snapshot_dir does not exist: ${args.snapshot_dir}`)
  }

  // Copy snapshot to a tmp work_dir (so install + build don't pollute).
  const work_dir = mkdtempSync(join(tmpdir(), `ist-metrics-${args.system}-${args.template}-${args.iter}-`))
  try {
    cpSync(args.snapshot_dir, work_dir, { recursive: true })

    // ─── BPR ──────────────────────────────────────────────────────
    const bpr = await computeBPR({
      snapshot_dir: args.snapshot_dir,
      work_dir,
    })

    // ─── SPR (needs BPR's served_dir) ────────────────────────────
    let spr: IterMetrics['smoke_pass_rate']
    let golden: SPRGolden | null = null
    if (!args.include_spr) {
      spr = {
        status: 'na',
        applicable: false,
        applicable_reason: 'SPR skipped (--no-spr)',
        console_errors: [],
        golden_captured: null,
        persistence_check: null,
        duration_ms: 0,
      }
    } else {
      const priorGolden = readPriorGolden(args)
      const sprResult = await computeSPR({
        served_dir: bpr.served_dir,
        prior_golden: priorGolden,
      })
      spr = sprResult.spr
      golden = sprResult.golden
      if (priorGolden && spr.persistence_check) {
        spr = {
          ...spr,
          persistence_check: {
            ...spr.persistence_check,
            checked_against_iter: args.iter - 1,
          },
        }
      }
    }

    // ─── TCMR ─────────────────────────────────────────────────────
    let tcmr: IterMetrics['test_coverage_maintenance']
    if (!args.include_tcmr) {
      tcmr = {
        status: 'na',
        applicable: false,
        applicable_reason: 'TCMR skipped for this system',
        test_command: null,
        exit_code: null,
        duration_ms: 0,
      }
    } else {
      tcmr = await computeTCMR({ work_dir })
    }

    // ─── CCD ──────────────────────────────────────────────────────
    let ccd = await computeCCD({
      snapshot_dir: args.snapshot_dir,
    })
    if (args.iter > 1 && ccd.applicable && ccd.mean_complexity !== null) {
      const iter1 = readIter1Mean(args)
      if (iter1 !== null) {
        ccd = {
          ...ccd,
          drift_from_iter1: Number((ccd.mean_complexity - iter1).toFixed(2)),
        }
      }
    }

    const metrics: IterMetrics = {
      cell: {
        system: args.system,
        template: args.template,
        iter: args.iter as IterMetrics['cell']['iter'],
      },
      computed_at: new Date().toISOString(),
      build_pass_rate: bpr,
      smoke_pass_rate: spr,
      test_coverage_maintenance: tcmr,
      complexity_drift: ccd,
    }

    const metrics_path = join(
      args.metrics_dir,
      args.system,
      args.template,
      `iter${pad2(args.iter)}.json`,
    )
    mkdirSync(dirname(metrics_path), { recursive: true })
    writeFileSync(metrics_path, JSON.stringify(metrics, null, 2))

    const golden_path = join(
      args.metrics_dir,
      args.system,
      args.template,
      'golden',
      `iter${pad2(args.iter)}.json`,
    )
    if (golden) {
      mkdirSync(dirname(golden_path), { recursive: true })
      writeFileSync(golden_path, JSON.stringify(golden, null, 2))
    }

    return { metrics, metrics_path, golden_path }
  } finally {
    rmSync(work_dir, { recursive: true, force: true })
  }
}

function readPriorGolden(args: RunMetricsArgs): SPRGolden | null {
  if (args.iter <= 1) return null
  const p = join(
    args.metrics_dir,
    args.system,
    args.template,
    'golden',
    `iter${pad2(args.iter - 1)}.json`,
  )
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SPRGolden
  } catch {
    return null
  }
}

function readIter1Mean(args: RunMetricsArgs): number | null {
  const p = join(args.metrics_dir, args.system, args.template, 'iter01.json')
  if (!existsSync(p)) return null
  try {
    const m = JSON.parse(readFileSync(p, 'utf8')) as IterMetrics
    const v: CCD = m.complexity_drift
    return v.mean_complexity
  } catch {
    return null
  }
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}
