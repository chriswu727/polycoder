#!/usr/bin/env node
// ist-aggregate — read all per-iter metrics under
// benchmarks/ist/metrics/, emit aggregated results under
// benchmarks/ist/results/.
//
// Usage:
//   pnpm ist-aggregate
//   pnpm ist-aggregate --systems polycoder-full,polycoder-coder-only
//
// --systems   : comma-separated list of systems (default: all 3)
// --templates : comma-separated list of templates (default: all 3)
//
// Emits:
//   benchmarks/ist/results/raw.json      — flat list, all per-iter rows
//   benchmarks/ist/results/summary.json  — AggregateResults
//   benchmarks/ist/results/summary.md    — human-readable tables
//   benchmarks/ist/results/charts/bpr.svg
//   benchmarks/ist/results/charts/spr.svg
//   benchmarks/ist/results/charts/ccd-mean-over-iters.svg
//
// Spec: docs/specs/iteration-survival-test.md §11.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { aggregateMetrics } from '../benchmarks/ist/aggregate/aggregate.js'
import { lineChart, barChart, type LineSeries, type BarGroup } from '../benchmarks/ist/aggregate/charts.js'
import type { IterMetrics } from '../benchmarks/ist/metrics/types.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const METRICS_DIR = join(REPO_ROOT, 'benchmarks', 'ist', 'metrics')
const RESULTS_DIR = join(REPO_ROOT, 'benchmarks', 'ist', 'results')

const ALL_SYSTEMS = ['polycoder-full', 'polycoder-coder-only', 'lovable']
const ALL_TEMPLATES = ['todo', 'dashboard', 'landing']

const { values: args } = parseArgs({
  options: {
    systems: { type: 'string' },
    templates: { type: 'string' },
  },
})

const systems = args.systems
  ? args.systems.split(',').map((s) => s.trim()).filter(Boolean)
  : ALL_SYSTEMS
const templates = args.templates
  ? args.templates.split(',').map((s) => s.trim()).filter(Boolean)
  : ALL_TEMPLATES

console.log(`ist-aggregate: systems=[${systems.join(',')}] templates=[${templates.join(',')}]`)

const out = aggregateMetrics({ metrics_root: METRICS_DIR, systems, templates })

mkdirSync(RESULTS_DIR, { recursive: true })
mkdirSync(join(RESULTS_DIR, 'charts'), { recursive: true })

writeFileSync(join(RESULTS_DIR, 'raw.json'), JSON.stringify(out.raw, null, 2))
writeFileSync(
  join(RESULTS_DIR, 'summary.json'),
  JSON.stringify(out.results, null, 2),
)

// ─── Charts ─────────────────────────────────────────────────────────

// 1. BPR pass rate per template, grouped by system.
const bprGroups: BarGroup[] = templates.map((template) => {
  const values: Record<string, number> = {}
  for (const system of systems) {
    const cell = out.results.cells.find((c) => c.system === system && c.template === template)
    if (cell?.bpr_pass_rate !== undefined && cell.bpr_pass_rate !== null) {
      values[system] = cell.bpr_pass_rate
    }
  }
  return { label: template, values }
})
writeFileSync(
  join(RESULTS_DIR, 'charts', 'bpr.svg'),
  barChart(bprGroups, systems, {
    title: 'Build Pass Rate by template',
    x_label: 'template',
    y_label: 'pass rate',
    y_range: [0, 1.05],
    show_values: true,
    format_value: (v) => `${(v * 100).toFixed(0)}%`,
  }),
)

// 2. SPR pass rate per template, grouped by system.
const sprGroups: BarGroup[] = templates.map((template) => {
  const values: Record<string, number> = {}
  for (const system of systems) {
    const cell = out.results.cells.find((c) => c.system === system && c.template === template)
    if (cell?.spr_pass_rate !== undefined && cell.spr_pass_rate !== null) {
      values[system] = cell.spr_pass_rate
    }
  }
  return { label: template, values }
})
writeFileSync(
  join(RESULTS_DIR, 'charts', 'spr.svg'),
  barChart(sprGroups, systems, {
    title: 'Smoke Pass Rate by template',
    x_label: 'template',
    y_label: 'pass rate',
    y_range: [0, 1.05],
    show_values: true,
    format_value: (v) => `${(v * 100).toFixed(0)}%`,
  }),
)

// 3. Mean complexity over iters, one line per system (averaged across templates).
const ccdSeries: LineSeries[] = systems.map((system) => {
  const points: Array<[number, number]> = []
  for (let iter = 1; iter <= 5; iter++) {
    const means: number[] = []
    for (const template of templates) {
      const m = readIterMetric(METRICS_DIR, system, template, iter)
      if (m?.complexity_drift.mean_complexity !== null && m?.complexity_drift.mean_complexity !== undefined) {
        means.push(m.complexity_drift.mean_complexity)
      }
    }
    if (means.length > 0) {
      const avg = means.reduce((a, b) => a + b, 0) / means.length
      points.push([iter, Number(avg.toFixed(3))])
    }
  }
  return { label: system, points }
})
writeFileSync(
  join(RESULTS_DIR, 'charts', 'ccd-mean-over-iters.svg'),
  lineChart(ccdSeries, {
    title: 'Mean cyclomatic complexity over iterations',
    x_label: 'iteration',
    y_label: 'mean complexity (avg over templates)',
  }),
)

// ─── Markdown summary ────────────────────────────────────────────────

const md: string[] = []
md.push('# IST aggregated results')
md.push('')
md.push(`Generated at: ${out.results.generated_at}`)
md.push('')
md.push(`Systems: ${systems.join(', ')}`)
md.push(`Templates: ${templates.join(', ')}`)
md.push('')

md.push('## Per-system headline')
md.push('')
md.push('| System | iters | BPR | SPR | TCMR | breaks | CCD drift @ iter5 |')
md.push('|--------|------:|----:|----:|-----:|-------:|------------------:|')
for (const sys of out.results.systems) {
  md.push(
    `| ${sys.system} | ${sys.total_iters} | ${pct(sys.bpr_pass_rate)} | ${pct(sys.spr_pass_rate)} | ${pct(sys.tcmr_pass_rate)} | ${sys.total_breaks} | ${num(sys.ccd_drift_mean_at_iter5)} |`,
  )
}
md.push('')

md.push('## Per-cell detail')
md.push('')
md.push('| System | Template | iters | BPR | SPR | TCMR | breaks | longest break | CCD iter1 | CCD iter5 | drift |')
md.push('|--------|----------|------:|----:|----:|-----:|-------:|--------------:|----------:|----------:|------:|')
for (const cell of out.results.cells) {
  md.push(
    `| ${cell.system} | ${cell.template} | ${cell.iters_present.join(',')} | ${pct(cell.bpr_pass_rate)} | ${pct(cell.spr_pass_rate)} | ${pct(cell.tcmr_pass_rate)} | ${cell.break_count} | ${cell.longest_break_run} | ${num(cell.ccd_mean_iter1)} | ${num(cell.ccd_mean_iter5)} | ${num(cell.ccd_drift_iter5)} |`,
  )
}
md.push('')

if (out.results.warnings.length > 0) {
  md.push('## Warnings')
  md.push('')
  for (const w of out.results.warnings) md.push(`- ${w}`)
  md.push('')
}

md.push('## Charts')
md.push('')
md.push('![BPR](./charts/bpr.svg)')
md.push('')
md.push('![SPR](./charts/spr.svg)')
md.push('')
md.push('![CCD over iters](./charts/ccd-mean-over-iters.svg)')

writeFileSync(join(RESULTS_DIR, 'summary.md'), md.join('\n') + '\n')

console.log()
console.log('ist-aggregate: wrote')
console.log(`  ${RESULTS_DIR}/raw.json (${out.raw.length} rows)`)
console.log(`  ${RESULTS_DIR}/summary.json (${out.results.cells.length} cells)`)
console.log(`  ${RESULTS_DIR}/summary.md`)
console.log(`  ${RESULTS_DIR}/charts/{bpr,spr,ccd-mean-over-iters}.svg`)
if (out.results.warnings.length > 0) {
  console.log(`ist-aggregate: ${out.results.warnings.length} warning(s) (see summary.md)`)
}

// ─── Helpers ────────────────────────────────────────────────────────

function pct(v: number | null): string {
  if (v === null) return '—'
  return `${(v * 100).toFixed(0)}%`
}

function num(v: number | null): string {
  if (v === null) return '—'
  return v.toFixed(2)
}

function readIterMetric(
  metricsRoot: string,
  system: string,
  template: string,
  iter: number,
): IterMetrics | null {
  const p = join(metricsRoot, system, template, `iter${iter.toString().padStart(2, '0')}.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as IterMetrics
  } catch {
    return null
  }
}

// readdirSync is used to verify completeness in --verbose mode (future).
void readdirSync
