// write_file tool — create a new file. Refuses to overwrite; use
// edit_file for that. Per docs/specs/tools.md §4.2.

import { writeFileSync, existsSync, mkdirSync, statSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { buildTool, ToolError } from './ToolDef.js'
import { resolveInWorkspace, displayPath } from './workspaceBoundary.js'

const MAX_WRITE_BYTES = 1 * 1024 * 1024 // 1 MB

export const WriteFileInputSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative path. Parent dirs auto-created.'),
  content: z.string().describe('File content. UTF-8.'),
})

export const WriteFileOutputSchema = z.object({
  path: z.string(),
  bytes_written: z.number().int(),
})

const TEST_FILE_PATTERN =
  /(\.test\.|\.spec\.)|(^|\/)(__tests__|test|tests)\//i

export const writeFileTool = buildTool({
  name: 'write_file',
  description:
    'Create a new file at the given workspace path. Refuses to overwrite an existing file — use edit_file to modify. Parent directories are auto-created. UTF-8 content; max 1MB per write.',
  inputSchema: WriteFileInputSchema,
  outputSchema: WriteFileOutputSchema,
  // Cordon Test Runner to test files only; let other write-allowed
  // roles (coder) write production code.
  allowedRoles: ['coder', 'test_runner'],

  async call(input, ctx) {
    const absPath = resolveInWorkspace('write_file', ctx.workspace_root, input.path)
    const display = displayPath(ctx.workspace_root, absPath)

    if (ctx.role === 'test_runner' && !TEST_FILE_PATTERN.test(input.path)) {
      throw new ToolError(
        'permission_denied',
        'write_file',
        `Test Runner may only write files matching test patterns (*.test.*, *.spec.*, **/test/**, **/__tests__/**). Got: ${input.path}`,
        false,
      )
    }

    const bytes = Buffer.byteLength(input.content, 'utf8')
    if (bytes > MAX_WRITE_BYTES) {
      throw new ToolError(
        'file_too_large',
        'write_file',
        `Write would exceed ${MAX_WRITE_BYTES} bytes (got ${bytes}).`,
        false,
        { path: absPath, size: bytes },
      )
    }

    if (existsSync(absPath)) {
      const stat = statSync(absPath)
      if (stat.isFile()) {
        throw new ToolError(
          'invalid_input',
          'write_file',
          `Refusing to overwrite existing file ${display}. Use edit_file instead.`,
          false,
          { path: absPath },
        )
      }
    }

    try {
      const parent = dirname(absPath)
      mkdirSync(parent, { recursive: true })
      // resolveInWorkspace skips symlink resolution when the target
      // doesn't exist yet — typical for write_file. But the PARENT now
      // exists (we just mkdir'd it). If a prior step planted a symlink
      // pointing outside the workspace, mkdirSync would have followed
      // it. Re-resolve the parent and confirm it still lives in root.
      const rootAbs = resolve(ctx.workspace_root)
      const realParent = realpathSync(parent)
      const relParent = relative(rootAbs, realParent)
      if (relParent.startsWith('..') || isAbsolute(relParent)) {
        throw new ToolError(
          'workspace_violation',
          'write_file',
          `Parent directory of ${display} resolves outside workspace via symlink.`,
          false,
          { workspace_root: rootAbs, real_parent: realParent },
        )
      }
      writeFileSync(absPath, input.content, { encoding: 'utf8' })
    } catch (e) {
      if (e instanceof ToolError) throw e
      throw new ToolError(
        'external_failure',
        'write_file',
        `Failed to write ${display}: ${e instanceof Error ? e.message : String(e)}`,
        false,
        e,
      )
    }

    ctx.emit_event({ type: 'side_effect', description: `wrote ${bytes} bytes to ${display}` })

    return { path: display, bytes_written: bytes }
  },
})
