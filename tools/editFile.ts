// edit_file tool — exact-string replacement in an existing file.
// Atomic write via temp + rename. Read-before-edit enforced.
// Per docs/specs/tools.md §4.3.

import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { buildTool, ToolError } from './ToolDef.js'
import { resolveInWorkspace, displayPath } from './workspaceBoundary.js'

export const EditFileInputSchema = z.object({
  path: z.string().min(1),
  old_string: z.string().min(1).describe('Exact text to find. Must be unique unless replace_all is true.'),
  new_string: z.string().describe('Replacement text. May be empty (deletion).'),
  replace_all: z.boolean().default(false),
})

export const EditFileOutputSchema = z.object({
  path: z.string(),
  replacements_made: z.number().int(),
  diff_unified: z.string(),
})

export const editFileTool = buildTool({
  name: 'edit_file',
  description:
    'Apply an exact-string replacement to an existing file. Refuses if the file has not been read in the current iteration. old_string must be unique unless replace_all is true. Atomic: write goes to a temp file then rename, so a failure leaves the original intact.',
  inputSchema: EditFileInputSchema,
  outputSchema: EditFileOutputSchema,
  allowedRoles: ['coder'],

  async call(input, ctx) {
    const absPath = resolveInWorkspace('edit_file', ctx.workspace_root, input.path)
    const display = displayPath(ctx.workspace_root, absPath)

    if (!existsSync(absPath) || !statSync(absPath).isFile()) {
      throw new ToolError(
        'file_not_found',
        'edit_file',
        `File not found: ${display}`,
        false,
        { path: absPath },
      )
    }

    if (!ctx.read_files_in_iteration.has(absPath)) {
      throw new ToolError(
        'invalid_input',
        'edit_file',
        `Must call read_file on ${display} before editing it (read-before-edit rule).`,
        false,
        { path: absPath },
      )
    }

    const original = readFileSync(absPath, 'utf8')

    if (!original.includes(input.old_string)) {
      throw new ToolError(
        'invalid_input',
        'edit_file',
        `old_string not found in ${display}.`,
        false,
        { path: absPath },
      )
    }

    let updated: string
    let count: number
    if (input.replace_all) {
      const parts = original.split(input.old_string)
      count = parts.length - 1
      updated = parts.join(input.new_string)
    } else {
      const occurrences = countOccurrences(original, input.old_string)
      if (occurrences > 1) {
        throw new ToolError(
          'invalid_input',
          'edit_file',
          `old_string is not unique in ${display} (found ${occurrences} occurrences). Use replace_all:true or supply more surrounding context.`,
          false,
          { path: absPath, occurrences },
        )
      }
      updated = original.replace(input.old_string, input.new_string)
      count = 1
    }

    if (updated === original) {
      throw new ToolError(
        'invalid_input',
        'edit_file',
        `new_string equals old_string — edit would have no effect.`,
        false,
        { path: absPath },
      )
    }

    // Atomic write: temp + rename.
    const tmp = join(dirname(absPath), `.${randomBytes(6).toString('hex')}.tmp`)
    try {
      writeFileSync(tmp, updated, { encoding: 'utf8' })
      renameSync(tmp, absPath)
    } catch (e) {
      throw new ToolError(
        'external_failure',
        'edit_file',
        `Failed to write ${display}: ${e instanceof Error ? e.message : String(e)}`,
        false,
        e,
      )
    }

    ctx.emit_event({
      type: 'side_effect',
      description: `edit_file ${display}: ${count} replacement${count === 1 ? '' : 's'}`,
    })

    return {
      path: display,
      replacements_made: count,
      diff_unified: simpleUnifiedDiff(display, original, updated),
    }
  },
})

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++
    pos += needle.length
  }
  return count
}

/**
 * Lightweight unified diff for display in tool output. Not a full
 * patch — line-by-line only, no context window. Sufficient for the
 * UI to show the change.
 */
function simpleUnifiedDiff(label: string, before: string, after: string): string {
  const a = before.split('\n')
  const b = after.split('\n')
  const lines: string[] = [`--- a/${label}`, `+++ b/${label}`]
  const maxLen = Math.max(a.length, b.length)
  for (let i = 0; i < maxLen; i++) {
    const aLine = a[i]
    const bLine = b[i]
    if (aLine === bLine) continue
    if (aLine !== undefined) lines.push(`-${aLine}`)
    if (bLine !== undefined) lines.push(`+${bLine}`)
  }
  return lines.join('\n')
}
