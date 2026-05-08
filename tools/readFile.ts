// read_file tool — read a workspace file, optionally a line range.
// Per docs/specs/tools.md §4.1.

import { readFileSync, statSync } from 'node:fs'
import { z } from 'zod'
import { buildTool, ToolError } from './ToolDef.js'
import { resolveInWorkspace, displayPath } from './workspaceBoundary.js'

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
const DEFAULT_MAX_LINES = 2000

export const ReadFileInputSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative or absolute path inside the workspace.'),
  start_line: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('1-based line to start at (inclusive). Default: 1.'),
  end_line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('1-based line to stop at (inclusive). Default: start_line + 2000.'),
})

export const ReadFileOutputSchema = z.object({
  content: z.string(),
  total_lines: z.number().int(),
  path: z.string(),
  truncated: z.boolean(),
})

export const readFileTool = buildTool({
  name: 'read_file',
  description:
    'Read the contents of a file in the workspace. Optionally read a specific line range with start_line / end_line (1-based, inclusive). Default reads up to 2000 lines starting from the file beginning. Returns content with each line prefixed by `<line_number>\\t` for unambiguous reference.',
  inputSchema: ReadFileInputSchema,
  outputSchema: ReadFileOutputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  allowedRoles: [
    'architect',
    'coder',
    'adversary',
    'long_term_critic',
    'test_runner',
    'designer',
  ],

  async call(input, ctx) {
    const absPath = resolveInWorkspace('read_file', ctx.workspace_root, input.path)

    let stat
    try {
      stat = statSync(absPath)
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'ENOENT') {
        throw new ToolError(
          'file_not_found',
          'read_file',
          `File not found: ${displayPath(ctx.workspace_root, absPath)}`,
          false,
          { path: absPath },
        )
      }
      throw new ToolError(
        'unknown',
        'read_file',
        `stat failed: ${e instanceof Error ? e.message : String(e)}`,
        false,
        e,
      )
    }
    if (stat.size > MAX_FILE_BYTES) {
      throw new ToolError(
        'file_too_large',
        'read_file',
        `File exceeds ${MAX_FILE_BYTES} bytes (got ${stat.size}). Use start_line/end_line to read a specific range, or split the file.`,
        false,
        { path: absPath, size: stat.size },
      )
    }

    const raw = readFileSync(absPath, 'utf8')
    const allLines = raw.split('\n')
    const total = allLines.length

    const start = Math.max(1, input.start_line ?? 1)
    const end = Math.min(total, input.end_line ?? start + DEFAULT_MAX_LINES - 1)

    const sliced = allLines.slice(start - 1, end)
    // Number-prefixed lines for stable references downstream.
    const numbered = sliced
      .map((line, idx) => `${start + idx}\t${line}`)
      .join('\n')

    // Track for read-before-edit rule.
    ctx.read_files_in_iteration.add(absPath)

    return {
      content: numbered,
      total_lines: total,
      path: displayPath(ctx.workspace_root, absPath),
      truncated: end < total,
    }
  },
})
