// @file-mention parser.
//
// A vibe-coder writes "fix the off-by-one in @src/auth.ts line 23".
// Instead of forcing the model to discover the file via read_file,
// we resolve the @-mention up front and prepend the file's content
// to the user message — so the first turn already has it in context.
//
// Mirrors Copilot's @workspace / Cursor's @file UX.
//
// Scope rules:
//   * Path must be workspace-relative, under the workspace root.
//     Tokens that don't resolve are silently ignored — the model will
//     just see the @-text as-is and can still read_file it manually.
//   * Files over 200 KB are skipped — too noisy for a single message.
//   * Same MAX_FILE_BYTES ceiling as read_file (10 MB).
//   * Tokens with no extension or that look like an email / handle
//     are not treated as paths.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, isAbsolute, normalize, relative } from 'node:path'

const MAX_INLINE_BYTES = 200 * 1024 // 200 KB

const MENTION_REGEX =
  /(^|[\s(])@([A-Za-z0-9_./-]+\.[A-Za-z0-9_.-]+)(?=$|[\s).,:;])/g

export type AtMentionResolved = {
  raw: string
  path: string
  content: string
  size: number
}

export type AtMentionUnresolved = {
  raw: string
  reason: 'not_found' | 'too_large' | 'outside_workspace' | 'not_a_file'
}

export type AtMentionParse = {
  resolved: AtMentionResolved[]
  unresolved: AtMentionUnresolved[]
}

export function parseAtMentions(
  instruction: string,
  workspaceRoot: string,
): AtMentionParse {
  const resolved: AtMentionResolved[] = []
  const unresolved: AtMentionUnresolved[] = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null
  MENTION_REGEX.lastIndex = 0
  while ((match = MENTION_REGEX.exec(instruction)) !== null) {
    const rawToken = match[2]
    if (!rawToken) continue
    if (seen.has(rawToken)) continue
    seen.add(rawToken)

    // Block obvious non-paths.
    if (rawToken.includes('@')) continue

    // Compose absolute path, then assert it's inside workspace.
    const absCandidate = isAbsolute(rawToken)
      ? normalize(rawToken)
      : resolve(workspaceRoot, rawToken)
    const rel = relative(workspaceRoot, absCandidate)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      unresolved.push({ raw: rawToken, reason: 'outside_workspace' })
      continue
    }

    if (!existsSync(absCandidate)) {
      unresolved.push({ raw: rawToken, reason: 'not_found' })
      continue
    }
    let stat
    try {
      stat = statSync(absCandidate)
    } catch {
      unresolved.push({ raw: rawToken, reason: 'not_found' })
      continue
    }
    if (!stat.isFile()) {
      unresolved.push({ raw: rawToken, reason: 'not_a_file' })
      continue
    }
    if (stat.size > MAX_INLINE_BYTES) {
      unresolved.push({ raw: rawToken, reason: 'too_large' })
      continue
    }

    const content = readFileSync(absCandidate, 'utf8')
    resolved.push({
      raw: rawToken,
      path: rel,
      content,
      size: stat.size,
    })
  }

  return { resolved, unresolved }
}

/**
 * Format the resolved mentions as a context block that prepends to
 * the user message. Each file is wrapped in <context_file path="...">
 * so the model knows it's pinned context, not user prose.
 */
export function formatMentionsContextBlock(
  parse: AtMentionParse,
): string {
  if (parse.resolved.length === 0 && parse.unresolved.length === 0) {
    return ''
  }
  const parts: string[] = []
  for (const r of parse.resolved) {
    parts.push(
      `<context_file path="${r.path}">\n${r.content}\n</context_file>`,
    )
  }
  if (parse.unresolved.length > 0) {
    const summary = parse.unresolved
      .map((u) => `  - @${u.raw} (${u.reason})`)
      .join('\n')
    parts.push(
      `<!-- The user mentioned these but they couldn't be resolved:\n${summary}\n-->`,
    )
  }
  return parts.join('\n\n')
}
