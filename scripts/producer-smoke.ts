#!/usr/bin/env node
// Producer smoke — exercise the conversational Producer agent
// against real DeepSeek + GLM keys. Two-turn flow:
//
//   Turn 1: user sends a VAGUE request → expect Producer to ask a
//           clarifying question, NOT immediately fire the pipeline.
//   Turn 2: user gives a concrete answer → expect Producer to
//           dispatch run_full_pipeline (or run_quick_edit) and
//           report back in plain Chinese.
//
// Usage:
//   POLYCODER_SMOKE_DEEPSEEK_KEY=... POLYCODER_SMOKE_GLM_KEY=...
//   pnpm tsx scripts/producer-smoke.ts
//
// Default Producer model: deepseek-chat (cheap, fast, Chinese-fluent).

import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDatabase } from '../data/connection.js'
import { createWorkspace, getHydratedWorkspace } from '../data/workspace.js'
import { addSecret, getHydratedSecret } from '../data/secrets.js'
import { handleApplyPreset } from '../electron/ipc/workspaceHandlers.js'
import { InMemoryKeystore } from '../electron/secrets/keystore.js'
import { buildProvider } from '../providers/registry.js'
import { runProducerTurn } from '../core/agents/producer.js'
import type { ProviderId } from '../core/types/workspace.js'

const KEYS_TO_TRY: Array<{ provider: ProviderId; envVar: string }> = [
  { provider: 'deepseek', envVar: 'POLYCODER_SMOKE_DEEPSEEK_KEY' },
  { provider: 'glm', envVar: 'POLYCODER_SMOKE_GLM_KEY' },
]

async function main(): Promise<void> {
  const keys: Array<{ provider: ProviderId; api_key: string }> = []
  for (const k of KEYS_TO_TRY) {
    const v = process.env[k.envVar]
    if (v) keys.push({ provider: k.provider, api_key: v })
  }
  if (keys.length === 0) {
    console.error('No keys in env. Need POLYCODER_SMOKE_DEEPSEEK_KEY at least.')
    process.exit(2)
  }
  console.log(`producer-smoke: keys = ${keys.map((k) => k.provider).join(', ')}`)

  const dbDir = mkdtempSync(join(tmpdir(), 'polycoder-prod-smoke-db-'))
  const wsRoot = mkdtempSync(join(tmpdir(), 'polycoder-prod-smoke-ws-'))
  mkdirSync(join(wsRoot, 'src'), { recursive: true })
  const db = openDatabase(join(dbDir, 'smoke.db'))
  const keystore = new InMemoryKeystore()

  console.log(`producer-smoke: workspace = ${wsRoot}`)
  console.log(`producer-smoke: db       = ${join(dbDir, 'smoke.db')}`)

  let exitCode = 0
  try {
    const ws = createWorkspace(db, {
      name: 'producer-smoke',
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
    handleApplyPreset(db, { workspace_id: ws.id, preset: 'budget' })

    const hydrated = getHydratedWorkspace(db, ws.id)!

    // Producer model: deepseek-chat (cheap, Chinese-fluent).
    const producerAssignment = hydrated.role_assignments.translator
    const producerSecret = await getHydratedSecret(
      db,
      keystore,
      ws.id,
      producerAssignment.secret_id!,
    )
    if (!producerSecret) throw new Error('producer secret missing')
    const producerProvider = buildProvider(producerSecret)

    // Coder for Quick Edit
    const coderAssignment = hydrated.role_assignments.coder
    const coderSecret = await getHydratedSecret(
      db,
      keystore,
      ws.id,
      coderAssignment.secret_id!,
    )
    if (!coderSecret) throw new Error('coder secret missing')
    const coderProvider = buildProvider(coderSecret)

    // Full pipeline provider factory (reuses budget preset)
    const providerFactoryForPipeline = async (role: typeof producerAssignment.role) => {
      const a = hydrated.role_assignments[role]
      if (!a.secret_id || !a.model_id) {
        throw new Error(`role ${role} unconfigured`)
      }
      const sec = await getHydratedSecret(db, keystore, ws.id, a.secret_id)
      if (!sec) throw new Error(`secret missing for role ${role}`)
      return { provider: buildProvider(sec), model: a.model_id }
    }

    // ─── Turn 1: VAGUE request → expect clarifying question ──────
    console.log('\n━━━ Turn 1: vague request ━━━')
    const turn1Input = '我想做个能记账的工具。'
    console.log(`USER: ${turn1Input}`)

    const t1 = await runProducerTurn({
      db,
      keystore,
      workspace: hydrated,
      producerProvider,
      producerModel: producerAssignment.model_id!,
      providerFactoryForPipeline,
      coderProvider,
      coderModel: coderAssignment.model_id!,
      priorMessages: [],
      newUserMessage: turn1Input,
    })
    console.log(`PRODUCER: ${t1.assistantText}`)
    console.log(
      `  → tools=${t1.toolInvocations.map((t) => t.name).join(',') || '(none)'} ` +
        `cost=$${t1.totalUsage.estimated_cost_usd.toFixed(4)} ` +
        `iters_created=${t1.iterationsCreated.length}`,
    )

    // Assertion: turn 1 should NOT have invoked run_full_pipeline.
    if (t1.toolInvocations.some((t) => t.name === 'run_full_pipeline')) {
      console.warn(
        '⚠ Turn 1 invoked run_full_pipeline — Producer did not ask clarifying question first.',
      )
    }
    if (t1.toolInvocations.length === 0) {
      console.log('✓ Producer asked a clarifying question first (no pipeline fired)')
    }

    // ─── Turn 2: concrete answer → expect dispatch ───────────────
    console.log('\n━━━ Turn 2: concrete answer ━━━')
    const turn2Input = '一个人用就行，记金额和说明，看本月总支出。'
    console.log(`USER: ${turn2Input}`)

    const t2 = await runProducerTurn({
      db,
      keystore,
      workspace: hydrated,
      producerProvider,
      producerModel: producerAssignment.model_id!,
      providerFactoryForPipeline,
      coderProvider,
      coderModel: coderAssignment.model_id!,
      priorMessages: t1.messages,
      newUserMessage: turn2Input,
    })
    console.log(`PRODUCER: ${t2.assistantText}`)
    console.log(
      `  → tools=${t2.toolInvocations.map((t) => t.name).join(',') || '(none)'} ` +
        `cost=$${t2.totalUsage.estimated_cost_usd.toFixed(4)} ` +
        `iters_created=${t2.iterationsCreated.length}`,
    )

    if (t2.iterationsCreated.length > 0) {
      console.log('✓ Producer dispatched the team (iteration created)')
    } else {
      console.log(
        '⚠ Producer did NOT dispatch on turn 2 — may have asked another clarifying question',
      )
    }

    console.log('\n━━━ Summary ━━━')
    console.log(
      `Total Producer cost: $${(t1.totalUsage.estimated_cost_usd + t2.totalUsage.estimated_cost_usd).toFixed(4)}`,
    )
    console.log(`Iterations created: ${t1.iterationsCreated.length + t2.iterationsCreated.length}`)
  } catch (e) {
    console.error('producer-smoke threw:', e)
    exitCode = 1
  } finally {
    db.close()
    if (process.env.POLYCODER_SMOKE_KEEP_WS === '1') {
      console.log(`producer-smoke: kept workspace at ${wsRoot}`)
      console.log(`producer-smoke: kept db at ${join(dbDir, 'smoke.db')}`)
    } else {
      rmSync(wsRoot, { recursive: true, force: true })
      rmSync(dbDir, { recursive: true, force: true })
    }
  }
  process.exit(exitCode)
}

await main()
