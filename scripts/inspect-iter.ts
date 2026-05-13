#!/usr/bin/env node
// Iter introspection — given a smoke DB path + iteration_id (or the
// most recent iteration), dumps every role's envelope, the full
// communicator payload, cost breakdown, and a listing of files
// in the workspace root. Used during pipeline-quality iteration to
// see exactly what each layer produced.
//
// Usage:
//   pnpm tsx scripts/inspect-iter.ts \
//     --db /tmp/polycoder-smoke-db-XXX/smoke.db \
//     --ws /tmp/polycoder-smoke-ws-XXX
//
// If --iter is omitted, the most-recent iteration is used.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { openDatabase } from '../data/connection.js'
import { listIterations, getIteration } from '../data/iterations.js'
import {
  totalsByIteration,
  listCostRecordsForIteration,
} from '../data/costRecords.js'

const { values: args } = parseArgs({
  options: {
    db: { type: 'string' },
    ws: { type: 'string' },
    iter: { type: 'string' },
  },
})

if (!args.db) {
  console.error('--db <path-to-smoke.db> required')
  process.exit(2)
}

const db = openDatabase(args.db)

let iterId = args.iter
if (!iterId) {
  // Find the workspace by inspecting workspaces; pick its most recent iter.
  const ws = db.prepare('SELECT id, name, workspace_root FROM workspaces LIMIT 1').get() as
    | { id: string; name: string; workspace_root: string }
    | undefined
  if (!ws) {
    console.error('no workspaces in DB')
    process.exit(1)
  }
  const list = listIterations(db, ws.id, { limit: 1 })
  if (list.length === 0) {
    console.error('no iterations for workspace')
    process.exit(1)
  }
  iterId = list[0]!.id
  console.log(`workspace: ${ws.name} (root=${ws.workspace_root})`)
}

const record = getIteration(db, iterId)
if (!record) {
  console.error('iter not found')
  process.exit(1)
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('ITERATION OVERVIEW')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`id              ${record.id}`)
console.log(`iter_number     ${record.iteration_number}`)
console.log(`status          ${record.status}`)
console.log(`traffic_light   ${record.traffic_light ?? '(none)'}`)
console.log(`duration_ms     ${record.duration_ms ?? '?'}`)
console.log(`total_cost_usd  ${record.total_cost_usd?.toFixed(4) ?? '?'}`)
console.log(`prompt:         ${record.user_prompt}`)
console.log(`files_changed   ${record.files_changed.length}`)
record.files_changed.forEach((f) => console.log(`  - ${f}`))

// Cost by role.
console.log()
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('COST BREAKDOWN')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
const totals = totalsByIteration(db, iterId)
const records = listCostRecordsForIteration(db, iterId)
console.log(
  `total: $${(totals?.total_cost_usd ?? 0).toFixed(4)} across ${
    totals?.call_count ?? records.length
  } calls`,
)
for (const r of records) {
  console.log(
    `  ${r.role.padEnd(20)} ${r.model.padEnd(28)} ` +
      `in=${r.input_tokens} out=${r.output_tokens} ` +
      `\$${r.estimated_cost_usd.toFixed(4)} ${r.duration_ms}ms`,
  )
}

// Role envelopes.
console.log()
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('ROLE ENVELOPES')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
const outputs = JSON.parse(record.role_outputs_json) as Record<string, {
  role?: string
  model?: string
  status?: string
  summary?: string
  payload?: unknown
}>
const ORDER = [
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
]
for (const role of ORDER) {
  const env = outputs[role]
  if (!env) continue
  console.log()
  console.log(`── ${role} ─────────────────────────────────────`)
  console.log(`status:  ${env.status}`)
  console.log(`model:   ${env.model}`)
  console.log(`summary: ${env.summary}`)
  console.log(`payload:`)
  console.log(JSON.stringify(env.payload, null, 2).split('\n').map((l) => '  ' + l).join('\n'))
}

// Conflicts.
const conflicts = JSON.parse(record.conflicts_json) as unknown[]
console.log()
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`CONFLICTS (${conflicts.length})`)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
for (const c of conflicts) {
  console.log(JSON.stringify(c, null, 2))
}

// Workspace file listing.
if (args.ws) {
  console.log()
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('WORKSPACE FILES (' + args.ws + ')')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else {
        const rel = relative(args.ws!, full)
        console.log(`  ${rel} (${stat.size} bytes)`)
      }
    }
  }
  try {
    walk(args.ws)
  } catch (e) {
    console.error('  workspace walk failed:', e instanceof Error ? e.message : String(e))
  }

  // Print short files inline.
  console.log()
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('FILE CONTENTS (≤4 KB each)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  function dump(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        dump(full)
      } else if (stat.size <= 4096) {
        const rel = relative(args.ws!, full)
        console.log()
        console.log(`── ${rel} ──`)
        console.log(readFileSync(full, 'utf8'))
      }
    }
  }
  try {
    dump(args.ws)
  } catch {
    /* ignore */
  }
}

db.close()
