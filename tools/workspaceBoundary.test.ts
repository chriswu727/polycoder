import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInWorkspace, displayPath } from './workspaceBoundary.js'
import { ToolError } from './ToolDef.js'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'polycoder-ws-'))
  // Real path; macOS /tmp is a symlink so we use realpath here for stable comparisons.
  workspaceRoot = realpathSync(workspaceRoot)
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'src', 'index.ts'), '// hi\n')
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('resolveInWorkspace', () => {
  it('accepts a relative path inside the workspace', () => {
    const resolved = resolveInWorkspace('read_file', workspaceRoot, 'src/index.ts')
    expect(resolved).toBe(join(workspaceRoot, 'src', 'index.ts'))
  })

  it('accepts an absolute path inside the workspace', () => {
    const abs = join(workspaceRoot, 'src', 'index.ts')
    const resolved = resolveInWorkspace('read_file', workspaceRoot, abs)
    expect(resolved).toBe(abs)
  })

  it('rejects ../ escape', () => {
    expect(() =>
      resolveInWorkspace('read_file', workspaceRoot, '../etc/passwd'),
    ).toThrow(ToolError)
  })

  it('rejects deeply-nested ../ escape', () => {
    expect(() =>
      resolveInWorkspace('read_file', workspaceRoot, 'src/../../escape.txt'),
    ).toThrow(ToolError)
  })

  it('rejects absolute path outside workspace', () => {
    expect(() =>
      resolveInWorkspace('read_file', workspaceRoot, '/etc/passwd'),
    ).toThrow(ToolError)
  })

  it('rejects symlink that escapes the workspace', () => {
    const linkPath = join(workspaceRoot, 'escape')
    // Need a target that exists outside
    symlinkSync('/etc/passwd', linkPath)
    expect(() => resolveInWorkspace('read_file', workspaceRoot, 'escape')).toThrow(
      /workspace/i,
    )
  })

  it('returns normalized candidate for non-existent path within workspace', () => {
    const resolved = resolveInWorkspace('write_file', workspaceRoot, 'new/file.txt')
    expect(resolved).toBe(join(workspaceRoot, 'new', 'file.txt'))
  })

  it('throws ToolError with code workspace_violation', () => {
    try {
      resolveInWorkspace('read_file', workspaceRoot, '../etc')
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError)
      const err = e as ToolError
      expect(err.code).toBe('workspace_violation')
    }
  })
})

describe('displayPath', () => {
  it('returns relative form when inside workspace', () => {
    const rel = displayPath(workspaceRoot, join(workspaceRoot, 'src', 'index.ts'))
    expect(rel).toBe(join('src', 'index.ts'))
  })

  it('returns absolute path when outside workspace', () => {
    expect(displayPath(workspaceRoot, '/etc/passwd')).toBe('/etc/passwd')
  })
})
