// Tool framework. Modeled on Claude Code's Tool.ts (see
// docs/claude-code-learnings.md §2), simplified to V0 scope per
// docs/specs/tools.md §1.

import type { ZodType } from 'zod'
import type Database from 'better-sqlite3'
import type { KeyStore } from '../electron/secrets/keystore.js'
import type { RoleType } from '@core/types/role.js'

// ─── Tool name registry ─────────────────────────────────────────────

export const TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'bash',
  'read_project_memory',
  'update_project_memory',
  'read_history',
  'ask_user_question',
  'read_design_tokens',
  'run_test_suite',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

// ─── Execution context ──────────────────────────────────────────────

/**
 * Context passed to every tool's call() — provides workspace info,
 * data layer handles, and optional event emission. Per-iteration state
 * (e.g. which files have been read this iteration, for edit_file's
 * read-before-edit rule) is also tracked here.
 */
export type ToolContext = {
  workspace_id: string
  workspace_root: string // absolute path
  iteration_id: string
  role: RoleType
  abort_signal: AbortSignal
  emit_event: (event: ToolEvent) => void

  /** Database handle. Tools reading or writing data layer use this. */
  db: Database.Database
  /** Keystore handle. Only secret-related tools need this; others ignore. */
  keystore: KeyStore

  /**
   * Files read in this iteration. Updated by read_file; checked by
   * edit_file (per docs/specs/tools.md §4.3 read-before-edit rule).
   */
  read_files_in_iteration: Set<string>

  /**
   * Iteration number (one-based). Passed through to data-layer fns
   * that record provenance (e.g. update_project_memory).
   */
  iteration_number: number
}

export type ToolEvent =
  | { type: 'progress'; message: string }
  | { type: 'partial_output'; text: string }
  | { type: 'side_effect'; description: string }

// ─── Errors ──────────────────────────────────────────────────────────

export type ToolErrorCode =
  | 'invalid_input'
  | 'permission_denied'
  | 'file_not_found'
  | 'file_too_large'
  | 'workspace_violation'
  | 'sandbox_violation'
  | 'timeout'
  | 'external_failure'
  | 'unknown'

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    readonly tool_name: ToolName,
    message: string,
    readonly recoverable: boolean,
    readonly raw_error?: unknown,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

// ─── ToolDef interface ───────────────────────────────────────────────

export type ToolDef<I = unknown, O = unknown> = {
  name: ToolName
  /** Shown to the model in the tool schema. Imperative, role-agnostic. */
  description: string

  inputSchema: ZodType<I>
  outputSchema: ZodType<O>

  call: (input: I, ctx: ToolContext) => Promise<O>

  /**
   * Pure read? Drives default permission policy and parallelism rules.
   * Default: false (assume writes).
   */
  isReadOnly?: (input: I) => boolean

  /**
   * Safe to run multiple instances simultaneously?
   * Default: false (orchestrator queues within a single role).
   */
  isConcurrencySafe?: (input: I) => boolean

  /**
   * Optional role allowlist. If set, orchestrator rejects out-of-scope
   * calls before reaching call(). undefined → any role's allowlist may
   * include this tool.
   */
  allowedRoles?: RoleType[]
}

// ─── Built tool with defaults filled in ─────────────────────────────

export type BuiltTool<I = unknown, O = unknown> = ToolDef<I, O> &
  Required<Pick<ToolDef<I, O>, 'isReadOnly' | 'isConcurrencySafe'>>

const TOOL_DEFAULTS = {
  isReadOnly: () => false,
  isConcurrencySafe: () => false,
} as const

/**
 * Build a complete ToolDef with safe defaults filled in for the
 * commonly-stubbed methods. All tools should be exported via this.
 */
export function buildTool<I, O>(def: ToolDef<I, O>): BuiltTool<I, O> {
  return {
    ...TOOL_DEFAULTS,
    ...def,
  } as BuiltTool<I, O>
}
