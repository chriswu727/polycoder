// Workspace boundary helpers. Every tool that takes a path resolves
// it through here — paths must stay within workspace_root. Symlinks
// pointing outside are rejected.

import { resolve, normalize, relative, isAbsolute } from 'node:path'
import { realpathSync } from 'node:fs'
import { ToolError, type ToolName } from './ToolDef.js'

/**
 * Resolve `inputPath` against `workspace_root` and ensure the result
 * stays inside the workspace. Returns the absolute, normalized path.
 *
 * @throws ToolError code 'workspace_violation' if the path escapes.
 */
export function resolveInWorkspace(
  toolName: ToolName,
  workspaceRoot: string,
  inputPath: string,
): string {
  const root = normalize(resolve(workspaceRoot))
  const candidate = isAbsolute(inputPath)
    ? normalize(inputPath)
    : normalize(resolve(root, inputPath))

  // Direct check: is candidate inside root?
  const rel = relative(root, candidate)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ToolError(
      'workspace_violation',
      toolName,
      `Path "${inputPath}" resolves outside the workspace root.`,
      false,
      { workspace_root: root, resolved: candidate },
    )
  }

  // Symlink check: if the path exists and resolves via realpath, ensure
  // realpath also stays in workspace. Skip if file doesn't exist
  // (relevant for write_file / edit_file pre-flight).
  try {
    const real = realpathSync(candidate)
    const realRel = relative(root, real)
    if (realRel.startsWith('..') || isAbsolute(realRel)) {
      throw new ToolError(
        'workspace_violation',
        toolName,
        `Path "${inputPath}" resolves (via symlink) outside the workspace root.`,
        false,
        { workspace_root: root, resolved: candidate, real_path: real },
      )
    }
    return real
  } catch (e) {
    // If realpath fails because the file doesn't exist, that's OK for
    // write paths — return the normalized candidate. Re-throw if it's
    // our own ToolError or some other unexpected error.
    if (e instanceof ToolError) throw e
    if (
      e instanceof Error &&
      'code' in e &&
      (e as { code?: string }).code === 'ENOENT'
    ) {
      return candidate
    }
    throw new ToolError(
      'unknown',
      toolName,
      `Failed to resolve path "${inputPath}": ${e instanceof Error ? e.message : String(e)}`,
      false,
      e,
    )
  }
}

/**
 * Render a path relative to the workspace for display in errors and
 * tool output. Falls back to the absolute path if relative would
 * escape.
 */
export function displayPath(workspaceRoot: string, absolutePath: string): string {
  const rel = relative(resolve(workspaceRoot), absolutePath)
  if (rel.startsWith('..') || isAbsolute(rel)) return absolutePath
  return rel
}
