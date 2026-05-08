#!/usr/bin/env node
// ist-metrics — compute BPR/SPR/TCMR/CCD for one or more cells.
//
// Usage:
//   pnpm ist-metrics --system polycoder-full --template todo --iter all
//   pnpm ist-metrics --system polycoder-full --template all  --iter all
//   pnpm ist-metrics --system polycoder-full --template todo --iter 3 --no-spr
//
// --system   : polycoder-full | polycoder-coder-only | lovable
// --template : todo | dashboard | landing | all
// --iter     : 1..5 | all
// --no-spr   : skip SPR (Playwright) — use when Chromium isn't installed
// --no-tcmr  : skip TCMR (default for non-polycoder-full systems)
// --force    : recompute even if metrics file already exists
//
// Reads:  benchmarks/ist/runs/<system>/<template>/snapshots/iter<NN>/
// Writes: benchmarks/ist/metrics/<system>/<template>/iter<NN>.json
// Writes: benchmarks/ist/metrics/<system>/<template>/golden/iter<NN>.json
//
// Spec: docs/specs/iteration-survival-test.md §6.

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { runMetrics } from '../benchmarks/ist/metrics/runMetrics.js'

type SystemId = 'polycoder-full' | 'polycoder-coder-only' | 'lovable'
type TemplateId = 'todo' | 'dashboard' | 'landing'

const ALL_TEMPLATES: TemplateId[] = ['todo', 'dashboard', 'landing']
const ALL_ITERS = [1, 2, 3, 4, 5] as const
type IterN = (typeof ALL_ITERS)[number]

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNS_DIR = join(REPO_ROOT, 'benchmarks', 'ist', 'runs')
const METRICS_DIR = join(REPO_ROOT, 'benchmarks', 'ist', 'metrics')

const { values: args } = parseArgs({
  options: {
    system: { type: 'string' },
    template: { type: 'string' },
    iter: { type: 'string' },
    'no-spr': { type: 'boolean', default: false },
    'no-tcmr': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
})

function fail(msg: string): never {
  console.error(`ist-metrics: ${msg}`)
  process.exit(2)
}

function parseSystem(s: string | undefined): SystemId {
  if (s === 'polycoder-full' || s === 'polycoder-coder-only' || s === 'lovable') {
    return s
  }
  fail(`--system must be polycoder-full|polycoder-coder-only|lovable (got ${s})`)
}

function parseTemplates(s: string | undefined): TemplateId[] {
  if (!s || s === 'all') return ALL_TEMPLATES
  if ((ALL_TEMPLATES as readonly string[]).includes(s)) return [s as TemplateId]
  fail(`--template must be todo|dashboard|landing|all (got ${s})`)
}

function parseIters(s: string | undefined): IterN[] {
  if (!s || s === 'all') return [...ALL_ITERS]
  const n = Number.parseInt(s, 10)
  if (n >= 1 && n <= 5) return [n as IterN]
  fail(`--iter must be 1..5 or all (got ${s})`)
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function snapshotDir(system: SystemId, template: TemplateId, iter: IterN): string {
  return join(RUNS_DIR, system, template, 'snapshots', `iter${pad2(iter)}`)
}

function metricsPath(system: SystemId, template: TemplateId, iter: IterN): string {
  return join(METRICS_DIR, system, template, `iter${pad2(iter)}.json`)
}

const system = parseSystem(args.system)
const templates = parseTemplates(args.template)
const iters = parseIters(args.iter)

// TCMR default: on for polycoder-full, off otherwise.
const include_tcmr = args['no-tcmr']
  ? false
  : system === 'polycoder-full'
const include_spr = !args['no-spr']

console.log(`ist-metrics: system=${system}`)
console.log(
  `ist-metrics: templates=[${templates.join(',')}] iters=[${iters.join(',')}] spr=${include_spr} tcmr=${include_tcmr}`,
)

mkdirSync(METRICS_DIR, { recursive: true })

type Row = {
  system: SystemId
  template: TemplateId
  iter: IterN
  bpr: string
  spr: string
  tcmr: string
  ccd_mean: string
  ccd_drift: string
}
const rows: Row[] = []

for (const template of templates) {
  for (const iter of iters) {
    const out = metricsPath(system, template, iter)
    if (existsSync(out) && !args.force) {
      console.log(`ist-metrics: skip ${system}/${template}/iter${pad2(iter)} — exists`)
      continue
    }
    const snap = snapshotDir(system, template, iter)
    if (!existsSync(snap)) {
      console.warn(
        `ist-metrics: ⚠ snapshot missing for ${system}/${template}/iter${pad2(iter)} — has the cell been run?`,
      )
      continue
    }

    console.log(
      `\nist-metrics: ▶ ${system}/${template}/iter${pad2(iter)}`,
    )
    try {
      const r = await runMetrics({
        system,
        template,
        iter,
        snapshot_dir: snap,
        metrics_dir: METRICS_DIR,
        include_spr,
        include_tcmr,
      })
      const m = r.metrics
      console.log(
        `  BPR=${m.build_pass_rate.status} ` +
          `SPR=${m.smoke_pass_rate.status} ` +
          `TCMR=${m.test_coverage_maintenance.status} ` +
          `CCD=${m.complexity_drift.mean_complexity ?? 'na'}`,
      )
      rows.push({
        system,
        template,
        iter,
        bpr: m.build_pass_rate.status,
        spr: m.smoke_pass_rate.status,
        tcmr: m.test_coverage_maintenance.status,
        ccd_mean: m.complexity_drift.mean_complexity?.toFixed(2) ?? '—',
        ccd_drift: m.complexity_drift.drift_from_iter1?.toFixed(2) ?? '—',
      })
    } catch (e) {
      console.error(`  threw:`, e)
    }
  }
}

console.log()
console.log('ist-metrics: summary')
console.log('────────────────────')
console.log(
  '  template     iter    BPR     SPR     TCMR    CCDmean    CCDdrift',
)
for (const r of rows) {
  console.log(
    `  ${r.template.padEnd(11)} iter${pad2(r.iter)}  ${r.bpr.padEnd(6)}  ${r.spr.padEnd(6)}  ${r.tcmr.padEnd(6)}  ${r.ccd_mean.padStart(7)}     ${r.ccd_drift.padStart(7)}`,
  )
}
