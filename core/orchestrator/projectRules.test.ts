import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectRules, formatRulesAddendum } from './projectRules.js'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'polycoder-rules-')))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('loadProjectRules', () => {
  it('returns null when no rules file is present', () => {
    expect(loadProjectRules(workspaceRoot)).toBeNull()
  })

  it('loads .polycoder/rules.md by preference', () => {
    mkdirSync(join(workspaceRoot, '.polycoder'))
    writeFileSync(
      join(workspaceRoot, '.polycoder', 'rules.md'),
      '# rules\nuse vitest\n',
    )
    writeFileSync(join(workspaceRoot, 'AGENTS.md'), 'fallback rule\n')
    const r = loadProjectRules(workspaceRoot)
    expect(r).not.toBeNull()
    expect(r?.text).toContain('use vitest')
    expect(r?.text).not.toContain('fallback rule')
  })

  it('falls back to AGENTS.md', () => {
    writeFileSync(join(workspaceRoot, 'AGENTS.md'), 'use Vue 3 not Vue 2\n')
    const r = loadProjectRules(workspaceRoot)
    expect(r?.text).toBe('use Vue 3 not Vue 2')
  })

  it('skips empty files and keeps looking', () => {
    writeFileSync(join(workspaceRoot, 'POLYCODER.md'), '   \n\n')
    writeFileSync(join(workspaceRoot, 'AGENTS.md'), 'actual rule\n')
    const r = loadProjectRules(workspaceRoot)
    expect(r?.text).toBe('actual rule')
  })

  it('truncates oversized files', () => {
    const big = 'x'.repeat(10 * 1024)
    writeFileSync(join(workspaceRoot, 'AGENTS.md'), big)
    const r = loadProjectRules(workspaceRoot)
    expect(r?.truncated).toBe(true)
    expect(r?.text.length).toBeLessThanOrEqual(8 * 1024)
  })
})

describe('formatRulesAddendum', () => {
  it('returns empty string for null', () => {
    expect(formatRulesAddendum(null)).toBe('')
  })

  it('wraps rules text in a clear delimiter', () => {
    const out = formatRulesAddendum({
      source_path: '/x/AGENTS.md',
      text: 'use vitest',
      truncated: false,
    })
    expect(out).toContain('Project rules')
    expect(out).toContain('use vitest')
    expect(out).toContain('End project rules')
  })

  it('notes truncation when applicable', () => {
    const out = formatRulesAddendum({
      source_path: '/x/AGENTS.md',
      text: 'rule',
      truncated: true,
    })
    expect(out).toContain('tail truncated')
  })
})
