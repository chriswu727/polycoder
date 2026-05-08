// Aggregator: walks benchmarks/ist/metrics/<system>/<template>/iter*.json,
// folds metrics into per-cell + per-system summaries, returns
// AggregateResults plus a flat array of RawRecord. Missing data is
// reported as warnings, never throws.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { IterMetrics } from '../metrics/types.js'
import type {
  AggregateResults,
  CellAggregate,
  RawRecord,
  SystemAggregate,
} from './types.js'

export type AggregateArgs = {
  metrics_root: string
  systems: string[]
  templates: string[]
}

export type AggregateOutput = {
  results: AggregateResults
  raw: RawRecord[]
}

export function aggregateMetrics(args: AggregateArgs): AggregateOutput {
  const warnings: string[] = []
  const cells: CellAggregate[] = []
  const raw: RawRecord[] = []

  for (const system of args.systems) {
    for (const template of args.templates) {
      const dir = join(args.metrics_root, system, template)
      if (!existsSync(dir)) {
        warnings.push(`no metrics for ${system}/${template}`)
        cells.push(emptyCell(system, template))
        continue
      }

      const iterFiles = readdirSync(dir)
        .filter((f) => /^iter\d+\.json$/.test(f))
        .sort()

      const iterMetrics: IterMetrics[] = []
      for (const f of iterFiles) {
        const path = join(dir, f)
        try {
          const m = JSON.parse(readFileSync(path, 'utf8')) as IterMetrics
          iterMetrics.push(m)
        } catch (e) {
          warnings.push(
            `failed to parse ${path}: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }

      if (iterMetrics.length === 0) {
        warnings.push(`metrics dir empty for ${system}/${template}`)
        cells.push(emptyCell(system, template))
        continue
      }

      // Sort defensively by iter.
      iterMetrics.sort((a, b) => a.cell.iter - b.cell.iter)

      // RawRecord rows.
      for (const m of iterMetrics) {
        const notes: string[] = []
        if (m.build_pass_rate.status === 'fail') {
          notes.push(`build: ${m.build_pass_rate.applicable_reason}`.slice(0, 120))
        }
        if (m.smoke_pass_rate.status === 'fail') {
          if (m.smoke_pass_rate.console_errors.length > 0) {
            notes.push(
              `console: ${m.smoke_pass_rate.console_errors[0]!.slice(0, 80)}`,
            )
          }
          if (m.smoke_pass_rate.persistence_check?.missing_text_fragments.length) {
            notes.push(
              `regression: missing ${m.smoke_pass_rate.persistence_check.missing_text_fragments.slice(0, 3).join('|')}`,
            )
          }
        }
        if (m.test_coverage_maintenance.status === 'fail') {
          notes.push(`tests: exit ${m.test_coverage_maintenance.exit_code}`)
        }
        raw.push({
          system,
          template,
          iter: m.cell.iter,
          bpr_status: m.build_pass_rate.status,
          spr_status: m.smoke_pass_rate.status,
          tcmr_status: m.test_coverage_maintenance.status,
          ccd_status: m.complexity_drift.status,
          ccd_mean: m.complexity_drift.mean_complexity,
          ccd_drift: m.complexity_drift.drift_from_iter1,
          computed_at: m.computed_at,
          notes,
        })
      }

      // Cell aggregate.
      const itersPresent = iterMetrics.map((m) => m.cell.iter)
      const bprApplicable = iterMetrics.filter((m) => m.build_pass_rate.applicable)
      const sprApplicable = iterMetrics.filter((m) => m.smoke_pass_rate.applicable)
      const tcmrApplicable = iterMetrics.filter((m) => m.test_coverage_maintenance.applicable)

      const bpr_pass_rate = passRate(bprApplicable.map((m) => m.build_pass_rate.status))
      const spr_pass_rate = passRate(sprApplicable.map((m) => m.smoke_pass_rate.status))
      const tcmr_pass_rate = passRate(
        tcmrApplicable.map((m) => m.test_coverage_maintenance.status),
      )

      // Break = BPR fail OR SPR fail in that iter.
      const broken = iterMetrics.map(
        (m) =>
          m.build_pass_rate.status === 'fail' ||
          m.smoke_pass_rate.status === 'fail',
      )
      const break_count = broken.filter(Boolean).length
      const longest_break_run = longestRun(broken, true)

      const iter1 = iterMetrics.find((m) => m.cell.iter === 1)
      const iter5 = iterMetrics.find((m) => m.cell.iter === 5)
      const ccd_mean_iter1 = iter1?.complexity_drift.mean_complexity ?? null
      const ccd_mean_iter5 = iter5?.complexity_drift.mean_complexity ?? null
      const ccd_drift_iter5 = iter5?.complexity_drift.drift_from_iter1 ?? null

      cells.push({
        system,
        template,
        iters_present: itersPresent,
        bpr_pass_rate,
        spr_pass_rate,
        tcmr_pass_rate,
        break_count,
        longest_break_run,
        ccd_mean_iter1,
        ccd_mean_iter5,
        ccd_drift_iter5,
      })
    }
  }

  // System aggregates.
  const systems: SystemAggregate[] = args.systems.map((system) => {
    const cs = cells.filter((c) => c.system === system)
    const templates_with_data = cs
      .filter((c) => c.iters_present.length > 0)
      .map((c) => c.template)

    const totalBpr = combineRates(cs.map((c) => [c.bpr_pass_rate, c.iters_present.length]))
    const totalSpr = combineRates(cs.map((c) => [c.spr_pass_rate, c.iters_present.length]))
    const totalTcmr = combineRates(cs.map((c) => [c.tcmr_pass_rate, c.iters_present.length]))
    const total_breaks = cs.reduce((a, c) => a + c.break_count, 0)
    const total_iters = cs.reduce((a, c) => a + c.iters_present.length, 0)

    const drifts = cs.map((c) => c.ccd_drift_iter5).filter((d): d is number => d !== null)
    const ccd_drift_mean_at_iter5 =
      drifts.length === 0
        ? null
        : Number((drifts.reduce((a, b) => a + b, 0) / drifts.length).toFixed(3))

    return {
      system,
      templates_with_data,
      bpr_pass_rate: totalBpr,
      spr_pass_rate: totalSpr,
      tcmr_pass_rate: totalTcmr,
      total_breaks,
      total_iters,
      ccd_drift_mean_at_iter5,
    }
  })

  return {
    results: {
      generated_at: new Date().toISOString(),
      systems_in_scope: args.systems,
      templates_in_scope: args.templates,
      cells,
      systems,
      warnings,
    },
    raw,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function emptyCell(system: string, template: string): CellAggregate {
  return {
    system,
    template,
    iters_present: [],
    bpr_pass_rate: null,
    spr_pass_rate: null,
    tcmr_pass_rate: null,
    break_count: 0,
    longest_break_run: 0,
    ccd_mean_iter1: null,
    ccd_mean_iter5: null,
    ccd_drift_iter5: null,
  }
}

function passRate(statuses: string[]): number | null {
  // Exclude `na` even if applicable was set inconsistently upstream.
  const ranked = statuses.filter((s) => s !== 'na')
  if (ranked.length === 0) return null
  const passes = ranked.filter((s) => s === 'pass').length
  return Number((passes / ranked.length).toFixed(3))
}

function longestRun<T>(arr: T[], target: T): number {
  let best = 0
  let cur = 0
  for (const v of arr) {
    if (v === target) {
      cur++
      if (cur > best) best = cur
    } else {
      cur = 0
    }
  }
  return best
}

function combineRates(weighted: Array<[number | null, number]>): number | null {
  let num = 0
  let den = 0
  for (const [rate, n] of weighted) {
    if (rate === null) continue
    num += rate * n
    den += n
  }
  return den === 0 ? null : Number((num / den).toFixed(3))
}
