// Tool registry. Single source of truth for the V0 toolset.
// `toolsForRole(role)` honors per-role allowlists (defined in the
// role definitions in core/roles/, Layer F) AND per-tool
// allowedRoles restrictions defined on each tool itself.

import type { RoleType } from '@core/types/role.js'
import type { BuiltTool, ToolName } from './ToolDef.js'
import { readFileTool } from './readFile.js'
import { writeFileTool } from './writeFile.js'
import { editFileTool } from './editFile.js'
import { bashTool } from './bash.js'
import { runTestSuiteTool } from './runTestSuite.js'
import { readProjectMemoryTool } from './readProjectMemory.js'
import { updateProjectMemoryTool } from './updateProjectMemory.js'
import { readHistoryTool } from './readHistory.js'
import { askUserQuestionTool } from './askUserQuestion.js'
import { readDesignTokensTool } from './readDesignTokens.js'

export const ALL_TOOLS: Record<ToolName, BuiltTool<unknown, unknown>> = {
  read_file: readFileTool as BuiltTool<unknown, unknown>,
  write_file: writeFileTool as BuiltTool<unknown, unknown>,
  edit_file: editFileTool as BuiltTool<unknown, unknown>,
  bash: bashTool as BuiltTool<unknown, unknown>,
  run_test_suite: runTestSuiteTool as BuiltTool<unknown, unknown>,
  read_project_memory: readProjectMemoryTool as BuiltTool<unknown, unknown>,
  update_project_memory: updateProjectMemoryTool as BuiltTool<unknown, unknown>,
  read_history: readHistoryTool as BuiltTool<unknown, unknown>,
  ask_user_question: askUserQuestionTool as BuiltTool<unknown, unknown>,
  read_design_tokens: readDesignTokensTool as BuiltTool<unknown, unknown>,
}

/**
 * Per-role allowlist as documented in docs/specs/tools.md §1
 * (under "Tool" subheading). The full RoleDefinition (Layer F) will
 * import these allowlists; defining them here keeps tools/ self-
 * contained.
 */
export const DEFAULT_ROLE_ALLOWLISTS: Record<RoleType, ToolName[]> = {
  translator: ['ask_user_question'],
  designer: ['read_file', 'read_design_tokens'],
  architect: ['read_file', 'read_project_memory', 'update_project_memory', 'read_history'],
  coder: ['read_file', 'write_file', 'edit_file', 'read_project_memory'],
  adversary: ['read_file', 'read_project_memory'],
  long_term_critic: ['read_file', 'read_project_memory', 'read_history'],
  test_runner: ['read_file', 'write_file', 'bash', 'run_test_suite', 'read_project_memory'],
  communicator: ['read_project_memory'],
}

/**
 * Resolve the toolset for a given role. Filters by:
 *   1. The role's static allowlist
 *   2. Each tool's `allowedRoles` (if set)
 *
 * If a tool is in the role's allowlist but the tool's allowedRoles
 * excludes it, the tool is silently dropped — defense in depth so a
 * misconfigured allowlist can't smuggle a tool past per-tool guards.
 */
export function toolsForRole(role: RoleType): BuiltTool<unknown, unknown>[] {
  const allowed = DEFAULT_ROLE_ALLOWLISTS[role] ?? []
  return allowed
    .map((name) => ALL_TOOLS[name])
    .filter((tool): tool is BuiltTool<unknown, unknown> => {
      if (!tool) return false
      if (!tool.allowedRoles) return true
      return tool.allowedRoles.includes(role)
    })
}
