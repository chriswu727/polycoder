// Producer IPC handlers — bridges the renderer's chat surface to the
// Producer conversational agent.
//
// Producer reuses the Translator's provider/model assignment (cheap +
// fast + Chinese-fluent matches Producer's needs). This may change to
// a dedicated assignment slot in V2.

import type Database from 'better-sqlite3'
import type { WebContents } from 'electron'

import type { KeyStore } from '../secrets/keystore.js'
import { runProducerTurn } from '@core/agents/producer.js'
import { getHydratedWorkspace } from '../../data/workspace.js'
import { getHydratedSecret } from '../../data/secrets.js'
import { buildProvider } from '@providers/registry.js'
import {
  appendProducerMessages,
  loadProducerMessages,
  listProducerHistory,
  type ProducerHistoryEntry,
} from '../../data/producerMessages.js'
import { PipelineEventBus } from '@core/orchestrator/events.js'
import type { ProviderFactory } from '@core/orchestrator/runIteration.js'
import type { RendererPipelineEvent } from './pipelineHandlers.js'
import {
  tryAcquireIterationSlot,
  setIterationId,
  releaseIterationSlot,
} from './iterationRegistry.js'

export type ProducerSendRequest = {
  workspace_id: string
  message: string
}

export type ProducerSendResponse =
  | {
      ok: true
      assistantText: string
      toolInvocations: Array<{ name: string; brief: string; ok: boolean }>
      iterationsCreated: string[]
      producer_cost_usd: number
    }
  | { ok: false; error: string }

export type ProducerHistoryRequest = { workspace_id: string }
export type ProducerHistoryResponse = {
  ok: true
  messages: ProducerHistoryEntry[]
}

export type ProducerHandlerDeps = {
  db: Database.Database
  keystore: KeyStore
  forwardEvent: (event: RendererPipelineEvent) => void
}

export async function handleProducerSend(
  deps: ProducerHandlerDeps,
  req: ProducerSendRequest,
): Promise<ProducerSendResponse> {
  const hydrated = getHydratedWorkspace(deps.db, req.workspace_id)
  if (!hydrated) {
    return { ok: false, error: `Workspace not found: ${req.workspace_id}` }
  }

  // Producer uses Translator's assignment for now (cheap+fast+CN).
  const translator = hydrated.role_assignments.translator
  if (!translator.secret_id || !translator.model_id) {
    return {
      ok: false,
      error: 'Producer needs Translator role configured. Open Settings → Team.',
    }
  }
  const tSecret = await getHydratedSecret(
    deps.db,
    deps.keystore,
    req.workspace_id,
    translator.secret_id,
  )
  if (!tSecret) {
    return { ok: false, error: 'Producer secret missing from keychain.' }
  }
  const producerProvider = buildProvider(tSecret)

  // Coder secret for Quick Edit dispatch
  const coder = hydrated.role_assignments.coder
  if (!coder.secret_id || !coder.model_id) {
    return {
      ok: false,
      error: 'Coder role not configured. Open Settings → Team.',
    }
  }
  const cSecret = await getHydratedSecret(
    deps.db,
    deps.keystore,
    req.workspace_id,
    coder.secret_id,
  )
  if (!cSecret) {
    return { ok: false, error: 'Coder secret missing from keychain.' }
  }
  const coderProvider = buildProvider(cSecret)

  // Provider factory for the full pipeline path
  const providerFactoryForPipeline: ProviderFactory = async (role) => {
    const a = hydrated.role_assignments[role]
    if (!a.secret_id || !a.model_id) {
      throw new Error(`Role "${role}" unconfigured.`)
    }
    const s = await getHydratedSecret(
      deps.db,
      deps.keystore,
      req.workspace_id,
      a.secret_id,
    )
    if (!s) throw new Error(`Secret missing for role ${role}.`)
    return { provider: buildProvider(s), model: a.model_id }
  }

  // Acquire the workspace's single-iteration slot for the whole
  // Producer turn — its inner tools (run_full_pipeline /
  // run_quick_edit) inherit the slot rather than each acquiring,
  // since they run sequentially within the Producer agent loop.
  const abortController = tryAcquireIterationSlot(req.workspace_id)
  if (!abortController) {
    return {
      ok: false,
      error: `An iteration is already running for workspace ${req.workspace_id}. Wait for it to finish before talking to the PM again.`,
    }
  }

  // Wire pipeline events to forward to renderer. Each iter the
  // Producer dispatches fires its own iteration_started → we update
  // the slot's iteration_id so the Stop button can find it.
  const bus = new PipelineEventBus()
  let currentIterationId = ''
  bus.subscribe((evt) => {
    if (evt.type === 'iteration_started') {
      currentIterationId = evt.iteration_id
      setIterationId(req.workspace_id, currentIterationId)
    }
    deps.forwardEvent({
      ...evt,
      workspace_id: req.workspace_id,
      iteration_id: currentIterationId,
    })
  })

  const priorMessages = loadProducerMessages(deps.db, req.workspace_id)

  try {
    const turn = await runProducerTurn({
      db: deps.db,
      keystore: deps.keystore,
      workspace: hydrated,
      producerProvider,
      producerModel: translator.model_id,
      providerFactoryForPipeline,
      coderProvider,
      coderModel: coder.model_id,
      priorMessages,
      newUserMessage: req.message,
      eventBus: bus,
      abort_signal: abortController.signal,
    })

    // Persist the NEW messages (those past priorMessages length). The
    // returned `messages` includes the entire history including the
    // new user message and Producer's assistant reply.
    const delta = turn.messages.slice(priorMessages.length)
    appendProducerMessages(deps.db, req.workspace_id, delta, {
      ...(turn.iterationsCreated.length > 0
        ? { iteration_id: turn.iterationsCreated[turn.iterationsCreated.length - 1] }
        : {}),
    })

    return {
      ok: true,
      assistantText: turn.assistantText,
      toolInvocations: turn.toolInvocations,
      iterationsCreated: turn.iterationsCreated,
      producer_cost_usd: turn.totalUsage.estimated_cost_usd,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    releaseIterationSlot(req.workspace_id)
  }
}

export function handleProducerHistory(
  deps: ProducerHandlerDeps,
  req: ProducerHistoryRequest,
): ProducerHistoryResponse {
  const messages = listProducerHistory(deps.db, req.workspace_id)
  return { ok: true, messages }
}

export function makeProducerForwarder(
  channel: string,
  webContents: WebContents,
): (event: RendererPipelineEvent) => void {
  return (event) => {
    if (!webContents.isDestroyed()) webContents.send(channel, event)
  }
}
