#!/usr/bin/env node
// Iteration Survival Test runner.
//
// Drives polycoder-full or polycoder-coder-only through one or more
// (template, iter) cells, persists results to benchmarks/ist/runs/,
// and prints a summary.
//
// Usage:
//
//   POLYCODER_SMOKE_DEEPSEEK_KEY=sk-... \
//   POLYCODER_SMOKE_GLM_KEY=...           \
//   pnpm ist-run --system polycoder-full --template todo --iter all
//   pnpm ist-run --system polycoder-full --template all  --iter all
//
// --system : polycoder-full | polycoder-coder-only
// --template: todo | dashboard | landing | all
// --iter   : 1..5 | all
// --preset : budget | china_pro | mixed
//            (default: china_pro for full, budget for coder-only)
// --force  : delete <system>/<template>/ before running (full reset)
// --dry-run: print plan, don't run anything
//
// Resume model: the DB and workspace persist across processes for a
// given (system, template) cell. To re-run a cell, pass --force —
// it deletes the cell directory so the next run starts cold from
// iter 1.
//
// Spec: docs/specs/iteration-survival-test.md

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { openDatabase } from '../data/connection.js'
import { createWorkspace, getHydratedWorkspace } from '../data/workspace.js'
import { addSecret, getHydratedSecret } from '../data/secrets.js'
import { handleApplyPreset } from '../electron/ipc/workspaceHandlers.js'
import {
  InMemoryKeystore,
  type KeyStore,
} from '../electron/secrets/keystore.js'
import {
  runIteration,
  type ProviderFactory,
} from '../core/orchestrator/runIteration.js'
import { runCoderOnly } from '../benchmarks/ist/runners/coderOnly.js'
import { buildProvider } from '../providers/registry.js'
import type { ProviderId, HydratedWorkspace } from '../core/types/workspace.js'
import type { PipelineResult } from '../core/types/iteration.js'
import type Database from 'better-sqlite3'

// ─── Constants ──────────────────────────────────────────────────────

type SystemId = 'polycoder-full' | 'polycoder-coder-only'
type TemplateId = 'todo' | 'dashboard' | 'landing'
type Preset = 'budget' | 'china_pro' | 'mixed'

const ALL_TEMPLATES: TemplateId[] = ['todo', 'dashboard', 'landing']
const ALL_ITERS = [1, 2, 3, 4, 5] as const
type IterN = (typeof ALL_ITERS)[number]

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROMPTS_DIR = join(REPO_ROOT, 'benchmarks', 'ist', 'prompts')
const RUNS_DIR = join(REPO_ROOT, 'benchmarks', 'ist', 'runs')

const KEYS_TO_TRY: Array<{ provider: ProviderId; envVar: string }> = [
  { provider: 'deepseek', envVar: 'POLYCODER_SMOKE_DEEPSEEK_KEY' },
  { provider: 'qwen', envVar: 'POLYCODER_SMOKE_QWEN_KEY' },
  { provider: 'glm', envVar: 'POLYCODER_SMOKE_GLM_KEY' },
  { provider: 'anthropic', envVar: 'POLYCODER_SMOKE_ANTHROPIC_KEY' },
]

const COST_CAP_USD = 30

// ─── Args ───────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    system: { type: 'string' },
    template: { type: 'string' },
    iter: { type: 'string' },
    preset: { type: 'string' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
})

function parseSystem(s: string | undefined): SystemId {
  if (s === 'polycoder-full' || s === 'polycoder-coder-only') return s
  fail(`--system must be polycoder-full or polycoder-coder-only (got ${s})`)
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

function parsePreset(s: string | undefined, _system: SystemId): Preset {
  // Default to `budget` — only requires DeepSeek + GLM, which is
  // what we have in our IST key set. `china_pro` would also need
  // Qwen for 5 of 8 roles; `mixed` would need Anthropic. Override
  // with --preset if you have those keys.
  const fallback: Preset = 'budget'
  if (!s) return fallback
  if (s === 'budget' || s === 'china_pro' || s === 'mixed') return s
  fail(`--preset must be budget|china_pro|mixed (got ${s})`)
}

function fail(msg: string): never {
  console.error(`ist-run: ${msg}`)
  process.exit(2)
}

// ─── Cell I/O paths ─────────────────────────────────────────────────

function cellDir(system: SystemId, template: TemplateId): string {
  return join(RUNS_DIR, system, template)
}

function workspaceDir(system: SystemId, template: TemplateId): string {
  return join(cellDir(system, template), 'workspace')
}

function dbPath(system: SystemId, template: TemplateId): string {
  return join(cellDir(system, template), 'data', 'polycoder.db')
}

function iterResultPath(
  system: SystemId,
  template: TemplateId,
  iter: IterN,
): string {
  return join(cellDir(system, template), `iter${pad2(iter)}.json`)
}

function snapshotDir(
  system: SystemId,
  template: TemplateId,
  iter: IterN,
): string {
  return join(cellDir(system, template), 'snapshots', `iter${pad2(iter)}`)
}

function promptPath(template: TemplateId, iter: IterN): string {
  return join(PROMPTS_DIR, `${template}-iter${pad2(iter)}.md`)
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

// ─── Main ───────────────────────────────────────────────────────────

const system = parseSystem(args.system)
const templates = parseTemplates(args.template)
const iters = parseIters(args.iter)
const preset = parsePreset(args.preset, system)

console.log(`ist-run: system=${system} preset=${preset}`)
console.log(
  `ist-run: templates=[${templates.join(',')}] iters=[${iters.join(',')}]`,
)
if (args.force) console.log('ist-run: --force will wipe each cell before running')
if (args['dry-run']) console.log('ist-run: --dry-run; nothing will execute')

// Collect keys
const keys: Array<{ provider: ProviderId; api_key: string }> = []
for (const k of KEYS_TO_TRY) {
  const v = process.env[k.envVar]
  if (v && v.length > 0) keys.push({ provider: k.provider, api_key: v })
}
if (keys.length === 0 && !args['dry-run']) {
  console.error('ist-run: no provider keys in env. Set at least one of:')
  for (const k of KEYS_TO_TRY) console.error(`  - ${k.envVar}`)
  process.exit(2)
}

type CellSummary = {
  system: SystemId
  template: TemplateId
  iter: IterN
  status: 'completed' | 'failed' | 'aborted' | 'skipped'
  traffic_light?: string
  duration_ms?: number
  total_cost_usd?: number
  files_changed?: number
  error?: string
}

const summary: CellSummary[] = []
let cumulativeCost = 0
let costCapHit = false

outer: for (const template of templates) {
  // Optional reset.
  if (args.force && existsSync(cellDir(system, template))) {
    console.log(`ist-run: --force, wiping ${cellDir(system, template)}`)
    if (!args['dry-run']) {
      rmSync(cellDir(system, template), { recursive: true, force: true })
    }
  }

  if (args['dry-run']) {
    for (const iter of iters) {
      const exists = existsSync(iterResultPath(system, template, iter))
      console.log(
        `ist-run: would ${exists ? 'skip' : 'run'} ${system}/${template}/iter${pad2(iter)}`,
      )
      summary.push({ system, template, iter, status: 'skipped' })
    }
    continue
  }

  // Set up cell once per template.
  let setup: CellSetup
  try {
    setup = await setupCell({ system, template, preset, keys })
  } catch (e) {
    console.error(`ist-run: setup failed for ${template}:`, e)
    for (const iter of iters) {
      summary.push({
        system,
        template,
        iter,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      })
    }
    continue
  }

  try {
    for (const iter of iters) {
      const resultFile = iterResultPath(system, template, iter)
      if (existsSync(resultFile)) {
        console.log(
          `ist-run: skip ${system}/${template}/iter${pad2(iter)} — exists`,
        )
        summary.push({ system, template, iter, status: 'skipped' })
        continue
      }

      const cellSummary = await runIter({ system, template, iter, setup })
      summary.push(cellSummary)
      if (cellSummary.total_cost_usd) {
        cumulativeCost += cellSummary.total_cost_usd
      }
      if (cumulativeCost > COST_CAP_USD) {
        console.error(
          `ist-run: cost cap $${COST_CAP_USD} exceeded ($${cumulativeCost.toFixed(2)}). HALTING.`,
        )
        costCapHit = true
        break outer
      }
    }
  } finally {
    setup.db.close()
  }
}

if (costCapHit) {
  console.error('ist-run: halted before completion due to cost cap.')
}

console.log()
console.log('ist-run: summary')
console.log('────────────────')
for (const s of summary) {
  const cost = s.total_cost_usd ? `$${s.total_cost_usd.toFixed(4)}` : '—'
  const dur = s.duration_ms ? `${(s.duration_ms / 1000).toFixed(0)}s` : '—'
  const tl = s.traffic_light ?? '—'
  console.log(
    `  ${s.template.padEnd(10)} iter${pad2(s.iter)}  ${s.status.padEnd(9)} ${tl.padEnd(6)} ${dur.padStart(5)}  ${cost.padStart(9)}`,
  )
}
console.log(`ist-run: cumulative cost so far = $${cumulativeCost.toFixed(4)}`)

// ─── Cell setup (per template) ──────────────────────────────────────

type CellSetup = {
  db: Database.Database
  keystore: KeyStore
  hydrated: HydratedWorkspace
  providerFactory: ProviderFactory
}

async function setupCell(p: {
  system: SystemId
  template: TemplateId
  preset: Preset
  keys: Array<{ provider: ProviderId; api_key: string }>
}): Promise<CellSetup> {
  const { system, template, preset, keys } = p
  const wsRoot = workspaceDir(system, template)
  const dbFile = dbPath(system, template)
  mkdirSync(wsRoot, { recursive: true })
  mkdirSync(dirname(dbFile), { recursive: true })

  const cellExists = existsSync(dbFile)
  const db = openDatabase(dbFile)
  const keystore = new InMemoryKeystore()

  if (cellExists) {
    db.close()
    throw new Error(
      `cell already initialized at ${dirname(dbFile)}. Pass --force to reset, or delete the cell directory manually.`,
    )
  }

  const ws = createWorkspace(db, {
    name: `ist-${system}-${template}`,
    workspace_root: wsRoot,
  })

  for (const k of keys) {
    await addSecret(db, keystore, {
      workspace_id: ws.id,
      name: `ist-${k.provider}`,
      provider: k.provider,
      api_key: k.api_key,
    })
  }

  const presetResult = handleApplyPreset(db, {
    workspace_id: ws.id,
    preset,
  })
  console.log(
    `ist-run: ${template} cell created. preset assignments_set = ${presetResult.assignments_set}`,
  )

  const hydrated = getHydratedWorkspace(db, ws.id)
  if (!hydrated) throw new Error('hydrated workspace null after creation')

  // Verify required roles are configured.
  const required: string[] =
    system === 'polycoder-full'
      ? Object.keys(hydrated.role_assignments)
      : ['coder']
  const unconfigured: string[] = []
  for (const role of required) {
    const a = hydrated.role_assignments[role as keyof typeof hydrated.role_assignments]
    if (!a?.secret_id || !a?.model_id) unconfigured.push(role)
  }
  if (unconfigured.length > 0) {
    db.close()
    throw new Error(
      `${unconfigured.length} role(s) unconfigured under preset ${preset} with the keys provided: ${unconfigured.join(', ')}`,
    )
  }

  const providerFactory: ProviderFactory = async (role) => {
    const a = hydrated.role_assignments[role]
    if (!a.secret_id || !a.model_id) {
      throw new Error(`role ${role} unconfigured`)
    }
    const sec = await getHydratedSecret(db, keystore, ws.id, a.secret_id)
    if (!sec) throw new Error(`secret missing for role ${role}`)
    return { provider: buildProvider(sec), model: a.model_id }
  }

  return { db, keystore, hydrated, providerFactory }
}

// ─── Per-iter runner ────────────────────────────────────────────────

async function runIter(p: {
  system: SystemId
  template: TemplateId
  iter: IterN
  setup: CellSetup
}): Promise<CellSummary> {
  const { system, template, iter, setup } = p

  const userPrompt = readFileSync(promptPath(template, iter), 'utf8').trim()
  console.log(
    `\nist-run: ▶ ${system}/${template}/iter${pad2(iter)}: ${JSON.stringify(userPrompt.slice(0, 80))}…`,
  )

  let result: PipelineResult
  const start = Date.now()
  try {
    if (system === 'polycoder-full') {
      result = await runIteration({
        db: setup.db,
        keystore: setup.keystore,
        workspace: setup.hydrated,
        user_prompt: userPrompt,
        providerFactory: setup.providerFactory,
      })
    } else {
      result = await runCoderOnly({
        db: setup.db,
        keystore: setup.keystore,
        workspace: setup.hydrated,
        user_prompt: userPrompt,
        providerFactory: setup.providerFactory,
      })
    }
  } catch (e) {
    console.error('ist-run: iter threw:', e)
    return {
      system,
      template,
      iter,
      status: 'failed',
      duration_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  }
  const elapsed = Date.now() - start

  // Persist iter result.
  const resultRecord = {
    system,
    template,
    iter,
    prompt: userPrompt,
    timestamp: new Date().toISOString(),
    duration_ms: elapsed,
    result,
  }
  writeFileSync(
    iterResultPath(system, template, iter),
    JSON.stringify(resultRecord, null, 2),
  )

  // Snapshot workspace files (excluding heavy/derived).
  const snap = snapshotDir(system, template, iter)
  mkdirSync(snap, { recursive: true })
  cpSync(workspaceDir(system, template), snap, {
    recursive: true,
    filter: (src) => {
      const base = src.split('/').pop() ?? ''
      return base !== 'node_modules' && base !== '.git' && base !== 'dist'
    },
  })

  if (result.status === 'completed') {
    console.log(
      `ist-run: ✓ ${result.traffic_light}, ${result.files_changed.length} files, ${(elapsed / 1000).toFixed(0)}s, $${result.total_cost_usd.toFixed(4)}`,
    )
    return {
      system,
      template,
      iter,
      status: 'completed',
      traffic_light: result.traffic_light,
      duration_ms: elapsed,
      total_cost_usd: result.total_cost_usd,
      files_changed: result.files_changed.length,
    }
  } else if (result.status === 'failed') {
    console.error(
      `ist-run: ✗ failed at ${result.stopped_at_role}: ${result.error_code}`,
    )
    return {
      system,
      template,
      iter,
      status: 'failed',
      duration_ms: elapsed,
      total_cost_usd: result.cost_so_far_usd,
      error: `${result.error_code}: ${result.error}`.slice(0, 200),
    }
  } else {
    console.warn(
      `ist-run: ⚠ aborted at ${result.stopped_at_role}: ${result.reason}`,
    )
    return {
      system,
      template,
      iter,
      status: 'aborted',
      duration_ms: elapsed,
      total_cost_usd: result.cost_so_far_usd,
      error: result.reason.slice(0, 200),
    }
  }
}
