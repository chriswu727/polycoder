// PipelineError — uniform error shape for orchestration failures.
// Distinct from ToolError (tool execution) and ProviderError (LLM API).
// See docs/specs/orchestrator.md §6.

import type { RoleType } from '@core/types/role.js'

export type PipelineErrorCode =
  | 'role_unconfigured' // workspace.role_assignments missing secret_id/model_id
  | 'role_invocation_failed' // invokeRole returned status:'failure'
  | 'memory_update_failed'
  | 'workspace_not_found'
  | 'iteration_already_running'
  | 'aborted'
  | 'unknown'

export class PipelineError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    readonly role: RoleType | null,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'PipelineError'
  }
}
