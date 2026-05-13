#!/usr/bin/env node
// polycoder end-to-end smoke test.
//
// Runs the full 8-role pipeline against real LLM APIs in a temp
// workspace, then prints a structured summary. Exit code 0 on
// completion, 1 on failure.
//
// Usage:
//
//   POLYCODER_SMOKE_DEEPSEEK_KEY=sk-... \
//   POLYCODER_SMOKE_GLM_KEY=...           \
//   pnpm tsx scripts/smoke.ts \
//     --prompt "build a tiny todo app with localStorage"
//
// Costs real money. Default prompt produces ~1-3 LLM calls per role
// across 8 roles → ~8-24 calls total. With Budget-preset rates
// (DeepSeek + GLM-Flash) this is typically well under $0.05.
//
// What this validates:
//   * IPC layer is bypassed; orchestrator + role harness wire-up
//     directly to real provider adapters
//   * All 8 roles can produce schema-valid envelopes from real LLMs
//   * Cost accounting accumulates correctly
//   * Iteration record + project memory persist correctly
//   * No envelope_parse_exhausted / payload_validation_exhausted
//     under default model assignments

import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { openDatabase } from '../data/connection.js'
import { createWorkspace, getHydratedWorkspace } from '../data/workspace.js'
import { addSecret } from '../data/secrets.js'
import { handleApplyPreset } from '../electron/ipc/workspaceHandlers.js'
import { InMemoryKeystore } from '../electron/secrets/keystore.js'
import { runIteration, type ProviderFactory } from '../core/orchestrator/runIteration.js'
import { getHydratedSecret } from '../data/secrets.js'
import { buildProvider } from '../providers/registry.js'
import { totalsByIteration } from '../data/costRecords.js'
import type { ProviderId } from '../core/types/workspace.js'

type Key = { provider: ProviderId; envVar: string; api_key: string }

const KEYS_TO_TRY: Array<{ provider: ProviderId; envVar: string }> = [
  { provider: 'deepseek', envVar: 'POLYCODER_SMOKE_DEEPSEEK_KEY' },
  { provider: 'qwen', envVar: 'POLYCODER_SMOKE_QWEN_KEY' },
  { provider: 'glm', envVar: 'POLYCODER_SMOKE_GLM_KEY' },
  { provider: 'anthropic', envVar: 'POLYCODER_SMOKE_ANTHROPIC_KEY' },
]

const { values: args } = parseArgs({
  options: {
    prompt: { type: 'string', default: 'build a tiny hello-world web page in src/index.html' },
    preset: { type: 'string', default: 'budget' },
  },
})

async function main(): Promise<void> {
  // ─── Collect available keys ──────────────────────────────────
  const keys: Key[] = []
  for (const k of KEYS_TO_TRY) {
    const value = process.env[k.envVar]
    if (value && value.length > 0) {
      keys.push({ provider: k.provider, envVar: k.envVar, api_key: value })
    }
  }
  if (keys.length === 0) {
    console.error('error: no provider keys in env. Set at least one of:')
    for (const k of KEYS_TO_TRY) console.error(`  - ${k.envVar}`)
    process.exit(2)
  }

  console.log(`smoke: ${keys.length} key(s) provided: ${keys.map((k) => k.provider).join(', ')}`)
  console.log(`smoke: prompt = ${JSON.stringify(args.prompt)}`)
  console.log(`smoke: preset = ${args.preset}`)

  // ─── Set up temp workspace ──────────────────────────────────
  const dbDir = mkdtempSync(join(tmpdir(), 'polycoder-smoke-db-'))
  const wsRoot = mkdtempSync(join(tmpdir(), 'polycoder-smoke-ws-'))
  mkdirSync(join(wsRoot, 'src'), { recursive: true })
  const db = openDatabase(join(dbDir, 'smoke.db'))
  const keystore = new InMemoryKeystore()

  console.log(`smoke: workspace_root = ${wsRoot}`)
  console.log(`smoke: db = ${join(dbDir, 'smoke.db')}`)

  let exitCode = 0
  try {
    const ws = createWorkspace(db, {
      name: 'smoke',
      workspace_root: wsRoot,
    })

    for (const k of keys) {
      await addSecret(db, keystore, {
        workspace_id: ws.id,
        name: `smoke-${k.provider}`,
        provider: k.provider,
        api_key: k.api_key,
      })
    }

    const presetResult = handleApplyPreset(db, {
      workspace_id: ws.id,
      preset: args.preset as 'budget' | 'china_pro' | 'mixed' | 'custom',
    })
    console.log(`smoke: preset assignments_set = ${presetResult.assignments_set}`)

    const hydrated = getHydratedWorkspace(db, ws.id)!
    let unconfigured = 0
    for (const [role, a] of Object.entries(hydrated.role_assignments)) {
      if (!a.secret_id || !a.model_id) {
        console.warn(`smoke: role ${role} unconfigured; will fail at invocation.`)
        unconfigured++
      } else {
        console.log(`smoke: ${role} → ${a.model_id}`)
      }
    }
    if (unconfigured > 0) {
      console.error(
        `smoke: ${unconfigured} role(s) unconfigured under preset "${args.preset}" with the keys provided. Provide more keys or pick a different preset.`,
      )
      exitCode = 3
      return
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

    console.log('smoke: starting runIteration…')
    const start = Date.now()
    const result = await runIteration({
      db,
      keystore,
      workspace: hydrated,
      user_prompt: String(args.prompt ?? ''),
      providerFactory,
    })
    const duration_ms = Date.now() - start

    console.log(`\nsmoke: runIteration → ${result.status} in ${duration_ms}ms`)
    if (result.status === 'completed') {
      console.log(`  iteration_id    = ${result.iteration_id}`)
      console.log(`  traffic_light   = ${result.traffic_light}`)
      console.log(`  total_cost_usd  = ${result.total_cost_usd.toFixed(4)}`)
      console.log(`  files_changed   = ${result.files_changed.length}`)
      console.log(`  conflicts       = ${result.conflicts.length}`)
      const cost = totalsByIteration(db, result.iteration_id)
      console.log(`  cost_records    = ${cost.call_count}`)
      console.log(
        `  role_outputs    = ${Object.keys(result.role_outputs).join(', ')}`,
      )
      const communicator = result.role_outputs.communicator?.payload as
        | { user_facing_text?: string }
        | undefined
      if (communicator?.user_facing_text) {
        console.log('\n  communicator.user_facing_text:')
        console.log('  ' + communicator.user_facing_text.split('\n').join('\n  '))
      }
      // Dump every role envelope so pipeline-quality iteration can
      // analyze WHERE each layer went weak (the headline summary
      // hides everything except Communicator's spin).
      if (process.env.POLYCODER_SMOKE_DUMP_ENVELOPES === '1') {
        for (const [role, env] of Object.entries(result.role_outputs)) {
          console.log(`\n── ${role} ─────────────────────────────`)
          console.log(`  status:  ${env?.status}`)
          console.log(`  summary: ${env?.summary}`)
          console.log('  payload:')
          const payloadJson = JSON.stringify(env?.payload, null, 2)
            .split('\n')
            .map((l) => '    ' + l)
            .join('\n')
          console.log(payloadJson)
        }
      }
    } else if (result.status === 'failed') {
      console.error('\nsmoke: FAILED')
      console.error(`  stopped_at_role = ${result.stopped_at_role}`)
      console.error(`  error_code      = ${result.error_code}`)
      console.error(`  error           = ${result.error}`)
      console.error(`  cost_so_far_usd = ${result.cost_so_far_usd.toFixed(4)}`)
      console.error(
        `  partial_outputs = ${Object.keys(result.partial_outputs).join(', ')}`,
      )
      // Dump every partial role envelope so the pipeline-quality
      // analyst (a human or another agent) can see WHERE it went
      // wrong without spelunking the SQLite DB. Stable iter
      // optimization workflow depends on this.
      for (const [role, env] of Object.entries(result.partial_outputs)) {
        console.error(`\n── ${role} ─────────────────────────────`)
        console.error(`  status:  ${env?.status}`)
        console.error(`  summary: ${env?.summary}`)
        console.error('  payload:')
        const payloadJson = JSON.stringify(env?.payload, null, 2)
          .split('\n')
          .map((l) => '    ' + l)
          .join('\n')
        console.error(payloadJson)
      }
      exitCode = 1
    } else {
      console.warn('\nsmoke: ABORTED')
      console.warn(`  stopped_at_role = ${result.stopped_at_role}`)
      console.warn(`  reason          = ${result.reason}`)
      exitCode = 1
    }
  } catch (e) {
    console.error('\nsmoke: threw:', e)
    exitCode = 1
  } finally {
    db.close()
    if (process.env.POLYCODER_SMOKE_KEEP_WS !== '1') {
      rmSync(wsRoot, { recursive: true, force: true })
      rmSync(dbDir, { recursive: true, force: true })
    } else {
      console.log(`smoke: kept workspace at ${wsRoot}`)
      console.log(`smoke: kept DB at ${join(dbDir, 'smoke.db')}`)
    }
  }

  process.exit(exitCode)
}

await main()
