// Pipeline IPC handlers — kicks off runIteration, forwards
// PipelineEventBus events to the renderer via webContents.send.
//
// Single-concurrent-iteration model in V0.1: at most one iteration
// per workspace runs at a time. The active controller lives here.

import type Database from 'better-sqlite3'
import type { WebContents } from 'electron'
import type { KeyStore } from '../secrets/keystore.js'
import { runIteration, type ProviderFactory } from '@core/orchestrator/runIteration.js'
import { runQuickEdit } from '@core/orchestrator/runQuickEdit.js'
import { revertIteration, type RevertResult } from '@core/orchestrator/revertIteration.js'
import { PipelineEventBus } from '@core/orchestrator/events.js'
import { getHydratedWorkspace } from '../../data/workspace.js'
import { getHydratedSecret } from '../../data/secrets.js'
import { buildProvider } from '@providers/registry.js'
import { listIterations, getIteration } from '../../data/iterations.js'
import {
  totalsByIteration,
  listCostRecordsForIteration,
} from '../../data/costRecords.js'
import type { PipelineEvent, PipelineResult } from '@core/types/iteration.js'
import type { RoleType } from '@core/types/role.js'

// ─── Active-iteration registry ──────────────────────────────────────

type ActiveIteration = {
  workspace_id: string
  iteration_id: string
  abortController: AbortController
}

const activeIterations = new Map<string, ActiveIteration>()

// ─── Request / response shapes ──────────────────────────────────────

export type StartIterationRequest = {
  workspace_id: string
  user_prompt: string
}

export type StartIterationResponse =
  | { ok: true; iteration_id: string; iteration_number: number }
  | { ok: false; error: string }

export type AbortIterationRequest = { workspace_id: string }
export type AbortIterationResponse = { ok: true; aborted: boolean }

export type ListIterationsRequest = { workspace_id: string; limit?: number }
export type ListIterationsResponse = ReturnType<typeof listIterations>

export type GetIterationRequest = { iteration_id: string }
export type GetIterationResponse =
  | { ok: true; record: ReturnType<typeof getIteration>; cost: ReturnType<typeof totalsByIteration>; cost_records: ReturnType<typeof listCostRecordsForIteration> }
  | { ok: false; error: string }

export type QuickEditRequest = {
  workspace_id: string
  instruction: string
  /**
   * Optional — when present, this Quick Edit continues the
   * conversation started in the named iteration. The prior message
   * history is loaded + the new instruction appended.
   */
  previous_iteration_id?: string
}

export type QuickEditResponse =
  | { ok: true; iteration_id: string; iteration_number: number }
  | { ok: false; error: string }

export type RevertIterationRequest = { iteration_id: string }
export type RevertIterationResponse = RevertResult

// Renderer-bound event payload for ipcRenderer.on
export type RendererPipelineEvent = PipelineEvent & {
  workspace_id: string
  iteration_id: string
}

// ─── Handlers ───────────────────────────────────────────────────────

export type PipelineHandlerDeps = {
  db: Database.Database
  keystore: KeyStore
  /** Function the handler calls to forward an event to the renderer. */
  forwardEvent: (event: RendererPipelineEvent) => void
}

export async function handleStartIteration(
  deps: PipelineHandlerDeps,
  req: StartIterationRequest,
): Promise<StartIterationResponse> {
  // Single concurrent iteration per workspace.
  if (activeIterations.has(req.workspace_id)) {
    return {
      ok: false,
      error: `An iteration is already running for workspace ${req.workspace_id}.`,
    }
  }

  const hydrated = getHydratedWorkspace(deps.db, req.workspace_id)
  if (!hydrated) {
    return { ok: false, error: `Workspace not found: ${req.workspace_id}` }
  }

  const abortController = new AbortController()

  // Build the provider factory once per iteration. It looks up
  // the role assignment + secret + keystore and constructs a
  // ModelProvider via the registry.
  const providerFactory: ProviderFactory = async (role: RoleType) => {
    const ws = getHydratedWorkspace(deps.db, req.workspace_id)
    if (!ws) throw new Error(`Workspace disappeared: ${req.workspace_id}`)
    const assignment = ws.role_assignments[role]
    if (!assignment.secret_id || !assignment.model_id) {
      throw new Error(
        `Role "${role}" is unconfigured (missing secret or model).`,
      )
    }
    const hydratedSecret = await getHydratedSecret(
      deps.db,
      deps.keystore,
      req.workspace_id,
      assignment.secret_id,
    )
    if (!hydratedSecret) {
      throw new Error(
        `Role "${role}" secret not found in keystore (id ${assignment.secret_id}).`,
      )
    }
    return {
      provider: buildProvider(hydratedSecret),
      model: assignment.model_id,
    }
  }

  // Set up the event bus + forwarder.
  const bus = new PipelineEventBus()
  let iterationId = ''
  bus.subscribe((evt) => {
    // Capture iteration_id from iteration_started event.
    if (evt.type === 'iteration_started') {
      iterationId = evt.iteration_id
    }
    deps.forwardEvent({
      ...evt,
      workspace_id: req.workspace_id,
      iteration_id: iterationId,
    })
  })

  // Kick off the iteration in a non-awaited promise so the IPC ack
  // returns immediately and the renderer starts listening for events.
  void (async () => {
    try {
      const result: PipelineResult = await runIteration({
        db: deps.db,
        keystore: deps.keystore,
        workspace: hydrated,
        user_prompt: req.user_prompt,
        providerFactory,
        abort_signal: abortController.signal,
        eventBus: bus,
      })

      // The bus already emitted iteration_completed/aborted/failed
      // inside runIteration; nothing more to do here aside from
      // unregistering the active iteration.
      void result
    } catch (e) {
      // runIteration handles its own try/catch; if anything still
      // escapes, log it.
      // eslint-disable-next-line no-console
      console.error('runIteration threw:', e)
    } finally {
      activeIterations.delete(req.workspace_id)
    }
  })()

  // Wait one tick for iteration_started to fire, so we can return
  // the iteration_id to the renderer. (runIteration emits it
  // synchronously after startIterationTrace.)
  await new Promise((r) => setTimeout(r, 0))

  const iter = getActiveOrLatest(deps.db, req.workspace_id, iterationId)
  if (!iter) {
    return { ok: false, error: 'Iteration failed to register.' }
  }

  activeIterations.set(req.workspace_id, {
    workspace_id: req.workspace_id,
    iteration_id: iter.id,
    abortController,
  })

  return {
    ok: true,
    iteration_id: iter.id,
    iteration_number: iter.iteration_number,
  }
}

function getActiveOrLatest(
  db: Database.Database,
  workspace_id: string,
  iterationIdHint: string,
): { id: string; iteration_number: number } | null {
  if (iterationIdHint) {
    const r = getIteration(db, iterationIdHint)
    if (r) return { id: r.id, iteration_number: r.iteration_number }
  }
  const list = listIterations(db, workspace_id, { limit: 1 })
  return list[0] ?? null
}

export async function handleQuickEdit(
  deps: PipelineHandlerDeps,
  req: QuickEditRequest,
): Promise<QuickEditResponse> {
  if (activeIterations.has(req.workspace_id)) {
    return {
      ok: false,
      error: `An iteration is already running for workspace ${req.workspace_id}.`,
    }
  }

  const hydrated = getHydratedWorkspace(deps.db, req.workspace_id)
  if (!hydrated) {
    return { ok: false, error: `Workspace not found: ${req.workspace_id}` }
  }

  // Quick Edit always uses the Coder assignment — that's the role
  // mapped to "make changes to code." If unconfigured, surface a
  // friendly error so the renderer can route to Settings.
  const coderAssignment = hydrated.role_assignments.coder
  if (!coderAssignment.secret_id || !coderAssignment.model_id) {
    return {
      ok: false,
      error:
        'Quick Edit needs the Coder role configured. Open Settings → Team and assign a model to Coder first.',
    }
  }
  const hydratedSecret = await getHydratedSecret(
    deps.db,
    deps.keystore,
    req.workspace_id,
    coderAssignment.secret_id,
  )
  if (!hydratedSecret) {
    return {
      ok: false,
      error:
        'Coder secret not found in the OS keychain. Re-add it under Settings → Secrets.',
    }
  }
  const provider = buildProvider(hydratedSecret)

  const abortController = new AbortController()
  const bus = new PipelineEventBus()
  let iterationId = ''
  bus.subscribe((evt) => {
    if (evt.type === 'iteration_started') {
      iterationId = evt.iteration_id
    }
    deps.forwardEvent({
      ...evt,
      workspace_id: req.workspace_id,
      iteration_id: iterationId,
    })
  })

  void (async () => {
    try {
      await runQuickEdit({
        db: deps.db,
        keystore: deps.keystore,
        workspace: hydrated,
        instruction: req.instruction,
        provider,
        model: coderAssignment.model_id ?? '',
        abort_signal: abortController.signal,
        eventBus: bus,
        ...(req.previous_iteration_id
          ? { previous_iteration_id: req.previous_iteration_id }
          : {}),
      })
    } catch (e) {
      // runQuickEdit handles its own errors and emits a failed event;
      // any escape here is a programmer bug.
      // eslint-disable-next-line no-console
      console.error('runQuickEdit threw:', e)
    } finally {
      activeIterations.delete(req.workspace_id)
    }
  })()

  // One tick for iteration_started to fire so we know the id.
  await new Promise((r) => setTimeout(r, 0))

  const iter = getActiveOrLatest(deps.db, req.workspace_id, iterationId)
  if (!iter) {
    return { ok: false, error: 'Quick Edit failed to register.' }
  }

  activeIterations.set(req.workspace_id, {
    workspace_id: req.workspace_id,
    iteration_id: iter.id,
    abortController,
  })

  return {
    ok: true,
    iteration_id: iter.id,
    iteration_number: iter.iteration_number,
  }
}

export function handleAbortIteration(
  _deps: PipelineHandlerDeps,
  req: AbortIterationRequest,
): AbortIterationResponse {
  const active = activeIterations.get(req.workspace_id)
  if (!active) return { ok: true, aborted: false }
  active.abortController.abort('user_aborted')
  return { ok: true, aborted: true }
}

export function handleListIterations(
  deps: PipelineHandlerDeps,
  req: ListIterationsRequest,
): ListIterationsResponse {
  const opts: { limit?: number } = {}
  if (req.limit !== undefined) opts.limit = req.limit
  return listIterations(deps.db, req.workspace_id, opts)
}

export function handleGetIteration(
  deps: PipelineHandlerDeps,
  req: GetIterationRequest,
): GetIterationResponse {
  const record = getIteration(deps.db, req.iteration_id)
  if (!record) return { ok: false, error: 'iteration not found' }
  return {
    ok: true,
    record,
    cost: totalsByIteration(deps.db, req.iteration_id),
    cost_records: listCostRecordsForIteration(deps.db, req.iteration_id),
  }
}

export function handleRevertIteration(
  deps: PipelineHandlerDeps,
  req: RevertIterationRequest,
): RevertIterationResponse {
  return revertIteration(deps.db, req.iteration_id)
}

// Forwarding helper for main.ts to pipe events into the renderer.
export function makeWebContentsForwarder(
  channel: string,
  webContents: WebContents,
): (event: RendererPipelineEvent) => void {
  return (event) => {
    if (!webContents.isDestroyed()) {
      webContents.send(channel, event)
    }
  }
}
