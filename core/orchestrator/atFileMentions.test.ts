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
import {
  parseAtMentions,
  formatMentionsContextBlock,
} from './atFileMentions.js'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'polycoder-at-')))
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'src', 'auth.ts'), 'export const auth = 1\n')
  writeFileSync(join(workspaceRoot, 'README.md'), '# hello\n')
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('parseAtMentions', () => {
  it('resolves a single workspace-relative @path', () => {
    const r = parseAtMentions('fix @src/auth.ts please', workspaceRoot)
    expect(r.resolved).toHaveLength(1)
    expect(r.resolved[0]?.path).toBe('src/auth.ts')
    expect(r.resolved[0]?.content).toContain('export const auth')
    expect(r.unresolved).toHaveLength(0)
  })

  it('deduplicates repeated mentions', () => {
    const r = parseAtMentions('@src/auth.ts and again @src/auth.ts', workspaceRoot)
    expect(r.resolved).toHaveLength(1)
  })

  it('reports unresolved tokens with reason', () => {
    const r = parseAtMentions('look at @missing/file.ts', workspaceRoot)
    expect(r.resolved).toHaveLength(0)
    expect(r.unresolved[0]?.reason).toBe('not_found')
  })

  it('blocks paths that resolve outside the workspace', () => {
    const r = parseAtMentions('look at @../escape.ts', workspaceRoot)
    expect(r.resolved).toHaveLength(0)
    expect(r.unresolved[0]?.reason).toBe('outside_workspace')
  })

  it('ignores tokens with no file extension', () => {
    const r = parseAtMentions('mention @teammate here', workspaceRoot)
    expect(r.resolved).toHaveLength(0)
    expect(r.unresolved).toHaveLength(0)
  })

  it('finds multiple mentions in one instruction', () => {
    const r = parseAtMentions(
      'edit @src/auth.ts and @README.md to add link',
      workspaceRoot,
    )
    expect(r.resolved).toHaveLength(2)
    const paths = r.resolved.map((x) => x.path).sort()
    expect(paths).toEqual(['README.md', 'src/auth.ts'])
  })

  it('rejects @-tokens embedded inside other identifiers (email-like)', () => {
    const r = parseAtMentions('contact me@example.com about @src/auth.ts', workspaceRoot)
    expect(r.resolved).toHaveLength(1)
    expect(r.resolved[0]?.path).toBe('src/auth.ts')
  })
})

describe('formatMentionsContextBlock', () => {
  it('emits a context_file block per resolved mention', () => {
    const r = parseAtMentions('@src/auth.ts', workspaceRoot)
    const block = formatMentionsContextBlock(r)
    expect(block).toContain('<context_file path="src/auth.ts">')
    expect(block).toContain('export const auth')
    expect(block).toContain('</context_file>')
  })

  it('emits an unresolved comment when mentions failed to resolve', () => {
    const r = parseAtMentions('@nope/file.ts', workspaceRoot)
    const block = formatMentionsContextBlock(r)
    expect(block).toContain("couldn't be resolved")
    expect(block).toContain('@nope/file.ts (not_found)')
  })

  it('returns empty string when nothing was mentioned', () => {
    const r = parseAtMentions('no mentions here', workspaceRoot)
    expect(formatMentionsContextBlock(r)).toBe('')
  })
})
