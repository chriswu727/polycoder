// Project rules — workspace-level user instructions.
//
// polycoder reads `.polycoder/rules.md` (or a few common aliases)
// from the workspace root and appends it to the system prompt. Lets
// vibe coders pin durable preferences without restating them every
// iteration: "use Vue 3 not Vue 2", "tests live in __tests__",
// "preserve the existing logging style", etc.
//
// Mirrors .cursor/rules / AGENTS.md / CLAUDE.md conventions, but
// kept deliberately simple — one file, prepended verbatim, capped
// in size. No glob-aware activation logic yet (deferred).

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_RULES_BYTES = 8 * 1024 // 8 KB; ~2k tokens

const CANDIDATES = [
  '.polycoder/rules.md',
  'POLYCODER.md',
  'AGENTS.md',
  'CLAUDE.md',
] as const

export type ProjectRules = {
  /** Absolute path to the file that was loaded. */
  source_path: string
  /** File content, stripped of trailing whitespace. Truncated if
   *  the file exceeded MAX_RULES_BYTES. */
  text: string
  /** True if the file was bigger than MAX_RULES_BYTES and got
   *  truncated. */
  truncated: boolean
}

/**
 * Look for a project rules file in well-known locations under the
 * workspace root. Returns null if none found.
 */
export function loadProjectRules(workspaceRoot: string): ProjectRules | null {
  for (const rel of CANDIDATES) {
    const abs = join(workspaceRoot, rel)
    if (!existsSync(abs)) continue
    let stat
    try {
      stat = statSync(abs)
    } catch {
      continue
    }
    if (!stat.isFile()) continue

    let raw: string
    try {
      raw = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const truncated = stat.size > MAX_RULES_BYTES
    const text = (truncated ? raw.slice(0, MAX_RULES_BYTES) : raw).trimEnd()
    if (text.length === 0) continue
    return { source_path: abs, text, truncated }
  }
  return null
}

/**
 * Format rules as a system-prompt addendum block. Empty string if
 * no rules — caller can concat unconditionally.
 */
export function formatRulesAddendum(rules: ProjectRules | null): string {
  if (!rules) return ''
  const note = rules.truncated
    ? '\n\n(Rules file was longer than 8 KB; tail truncated.)'
    : ''
  return [
    '',
    '─── Project rules ─────────────────────────────────────────────',
    'The user has pinned these instructions for this workspace. They',
    'override your default behavior where they conflict. Respect them',
    "even if they're unusual — they encode constraints you can't see.",
    '',
    rules.text + note,
    '─── End project rules ─────────────────────────────────────────',
  ].join('\n')
}
