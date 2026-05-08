// promptAssembly — concatenates the static system prompt for a given
// role, then appends the dynamic per-iteration suffix.
//
// Static section (cacheable across iterations within a session):
//   * docs/prompts/00-shared-preamble.md (verbatim)
//   * docs/prompts/{01..08}-{role}.md (verbatim, prompt's §4-10)
//
// Boundary marker:
//   * `___POLYCODER_PROMPT_BOUNDARY___` (literal; see ADR-009)
//
// Dynamic section (per-iteration, NOT cacheable):
//   * Workspace name, iteration number
//   * Project memory snapshot summary
//   * Note pointing the model at the user message for input

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POLYCODER_PROMPT_BOUNDARY } from '@providers/prepareSystemPrompt.js'
import { ROLE_DEFINITIONS } from '@core/roles/index.js'
import type { RoleType } from '@core/types/role.js'
import type { ProjectMemory } from '@core/types/projectMemory.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Resolve the path to docs/prompts/. Works in:
//   * Dev (tsx): __dirname is core/roleHarness/, so go ../../docs/prompts
//   * Compiled (dist/electron): main.js is in dist/electron/electron/,
//     and the source paths are mirrored, so the relative resolution
//     still works because we ship docs/ alongside compiled JS.
//   * Tests: same as dev.
const PROMPTS_DIR_CANDIDATES = [
  resolve(__dirname, '..', '..', 'docs', 'prompts'),
  resolve(__dirname, '..', '..', '..', 'docs', 'prompts'),
  resolve(__dirname, '..', '..', '..', '..', 'docs', 'prompts'),
]

function findPromptsDir(): string {
  for (const candidate of PROMPTS_DIR_CANDIDATES) {
    if (existsSync(resolve(candidate, '00-shared-preamble.md'))) {
      return candidate
    }
  }
  throw new Error(
    `Cannot locate docs/prompts/. Tried:\n  - ${PROMPTS_DIR_CANDIDATES.join('\n  - ')}`,
  )
}

// Lazy-load + cache prompt files. Loaded on first use; survives across
// pipeline runs in the same process.
const _cache = new Map<string, string>()

export function loadPromptFile(filename: string): string {
  let content = _cache.get(filename)
  if (content !== undefined) return content
  const path = resolve(findPromptsDir(), filename)
  content = readFileSync(path, 'utf8')
  _cache.set(filename, content)
  return content
}

/**
 * Test seam: clear the in-memory prompt cache. Used in tests that
 * monkeypatch the prompts directory or mutate prompt files.
 */
export function _clearPromptCacheForTesting(): void {
  _cache.clear()
}

// ─── Dynamic suffix data ────────────────────────────────────────────

export type DynamicPromptInputs = {
  workspace_name: string
  iteration_number: number
  project_memory: ProjectMemory | null
  /**
   * Number of past iterations in this workspace. Used in the dynamic
   * suffix to set context ("you are processing iteration N").
   */
  total_iterations: number
}

// ─── Assembly ───────────────────────────────────────────────────────

/**
 * Build the complete system prompt for a given role.
 *
 * Returns a single string with the boundary marker embedded; provider
 * adapters split / strip per their own caching strategy (see
 * providers/prepareSystemPrompt.ts).
 */
export function assembleSystemPrompt(
  role: RoleType,
  dynamic: DynamicPromptInputs,
): string {
  const def = ROLE_DEFINITIONS[role]
  const sharedPreamble = loadPromptFile('00-shared-preamble.md')
  const roleSpecificRaw = loadPromptFile(def.prompt_filename)
  // Role prompt markdown ends with a documentation-only
  // "## Dynamic suffix" section that contains an example boundary
  // marker for human reference. Strip it before assembly — the real
  // dynamic suffix is produced by renderDynamicSuffix(), and we own
  // where the boundary marker appears (exactly once).
  const roleSpecific = stripDocumentedDynamicSuffix(roleSpecificRaw)

  const staticSection = [sharedPreamble, '', roleSpecific].join('\n')
  const dynamicSection = renderDynamicSuffix(role, dynamic)

  return [
    staticSection,
    '',
    POLYCODER_PROMPT_BOUNDARY,
    '',
    dynamicSection,
  ].join('\n')
}

const DYNAMIC_SUFFIX_HEADER_RE = /^##\s+Dynamic suffix\b.*$/m

function stripDocumentedDynamicSuffix(markdown: string): string {
  const match = DYNAMIC_SUFFIX_HEADER_RE.exec(markdown)
  if (!match) return markdown
  return markdown.slice(0, match.index).trimEnd()
}

function renderDynamicSuffix(role: RoleType, d: DynamicPromptInputs): string {
  const lines: string[] = [
    '# Iteration context',
    '',
    `You are role "${role}" processing iteration ${d.iteration_number} for workspace "${d.workspace_name}".`,
    `This workspace has accumulated ${d.total_iterations} prior iteration(s).`,
    '',
  ]

  if (d.project_memory) {
    lines.push('## Project memory snapshot')
    lines.push(summarizeMemory(d.project_memory))
    lines.push('')
  } else {
    lines.push('## Project memory snapshot')
    lines.push('(empty — first iteration)')
    lines.push('')
  }

  lines.push(
    'The structured `<role-input>` envelope (containing upstream role outputs and the task for this iteration) is delivered as the next user message. Process it and emit a single `<role-output>` envelope per your role spec.',
  )

  return lines.join('\n')
}

function summarizeMemory(memory: ProjectMemory): string {
  const counts = [
    `decisions: ${memory.decisions.length}`,
    `conventions: ${memory.conventions.length}`,
    `components: ${memory.components_registry.length}`,
    `tech_debt: ${memory.tech_debt.length}`,
    `design_tokens.colors: ${Object.keys(memory.design_tokens.colors).length}`,
  ].join(', ')

  // Inline the most recent 3 decisions as a quick reference; bulk
  // memory consumption goes through `read_project_memory` tool.
  const recent = memory.decisions
    .slice(-3)
    .map((d) => `- ${d.decision} — ${d.rationale}`)
    .join('\n')

  return [
    `Counts: ${counts}.`,
    recent ? `\nMost recent decisions:\n${recent}` : '',
    '',
    'Use the `read_project_memory` tool for the full snapshot when you need it.',
  ]
    .filter(Boolean)
    .join('\n')
}
