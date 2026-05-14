// Single-iteration-per-workspace concurrency guard.
//
// Both direct iteration starts (handleStartIteration) and Producer-
// dispatched runs (Producer's run_full_pipeline / run_quick_edit
// tools) must call into this registry. Without it, two concurrent
// pipelines on the same workspace race on file writes, iteration_
// number uniqueness, and abort signals.

export type ActiveIteration = {
  workspace_id: string
  iteration_id: string
  abortController: AbortController
}

const activeIterations = new Map<string, ActiveIteration>()

export function getActiveIteration(
  workspace_id: string,
): ActiveIteration | undefined {
  return activeIterations.get(workspace_id)
}

export function hasActiveIteration(workspace_id: string): boolean {
  return activeIterations.has(workspace_id)
}

export function tryAcquireIterationSlot(
  workspace_id: string,
): AbortController | null {
  if (activeIterations.has(workspace_id)) return null
  const ac = new AbortController()
  activeIterations.set(workspace_id, {
    workspace_id,
    iteration_id: '', // filled once orchestrator emits iteration_started
    abortController: ac,
  })
  return ac
}

export function setIterationId(
  workspace_id: string,
  iteration_id: string,
): void {
  const slot = activeIterations.get(workspace_id)
  if (slot) slot.iteration_id = iteration_id
}

export function releaseIterationSlot(workspace_id: string): void {
  activeIterations.delete(workspace_id)
}

export function abortIteration(workspace_id: string): boolean {
  const slot = activeIterations.get(workspace_id)
  if (!slot) return false
  slot.abortController.abort('user_aborted')
  return true
}
