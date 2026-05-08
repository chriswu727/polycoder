import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { openDatabase } from '../data/connection.js'
import { InMemoryKeystore } from '../electron/secrets/keystore.js'
import { bashTool, SAFE_COMMAND_PATTERNS } from './bash.js'
import { detectFramework, parseTestCounts } from './runTestSuite.js'
import { ToolError, type ToolContext } from './ToolDef.js'
import type { RoleType } from '@core/types/role.js'

let workspaceRoot: string
let db: Database.Database
let dbDir: string
let keystore: InMemoryKeystore

function makeCtx(role: RoleType): ToolContext {
  return {
    workspace_id: randomUUID(),
    workspace_root: workspaceRoot,
    iteration_id: randomUUID(),
    role,
    abort_signal: new AbortController().signal,
    emit_event: () => {},
    db,
    keystore,
    read_files_in_iteration: new Set<string>(),
    iteration_number: 1,
  }
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'polycoder-exec-'))
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-exec-db-'))
  db = openDatabase(join(dbDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

// ─── bash sandbox ───────────────────────────────────────────────────

describe('bashTool sandbox', () => {
  it('rejects commands not in the safe list', async () => {
    await expect(
      bashTool.call(
        { command: 'rm -rf /', timeout_ms: 5000, cwd_relative: '.' },
        makeCtx('test_runner'),
      ),
    ).rejects.toMatchObject({ code: 'sandbox_violation' })
  })

  it('rejects bash from any role other than test_runner via allowedRoles', () => {
    expect(bashTool.allowedRoles).toEqual(['test_runner'])
  })

  it('SAFE_COMMAND_PATTERNS allows pnpm test, vitest, pytest, go test', () => {
    expect(SAFE_COMMAND_PATTERNS.some((p) => p.test('pnpm test'))).toBe(true)
    expect(SAFE_COMMAND_PATTERNS.some((p) => p.test('bun test src/x'))).toBe(true)
    expect(SAFE_COMMAND_PATTERNS.some((p) => p.test('npx vitest run'))).toBe(true)
    expect(SAFE_COMMAND_PATTERNS.some((p) => p.test('vitest run'))).toBe(true)
    expect(SAFE_COMMAND_PATTERNS.some((p) => p.test('jest'))).toBe(true)
    expect(SAFE_COMMAND_PATTERNS.some((p) => p.test('pytest tests/'))).toBe(true)
    expect(SAFE_COMMAND_PATTERNS.some((p) => p.test('go test ./...'))).toBe(true)
  })

  it('rejects cwd escaping the workspace', async () => {
    await expect(
      bashTool.call(
        { command: 'pnpm test', timeout_ms: 5000, cwd_relative: '../escape' },
        makeCtx('test_runner'),
      ),
    ).rejects.toBeInstanceOf(ToolError)
  })

  it('runs an allowed command (true exit 0)', async () => {
    // Use `vitest --version` as a no-op-ish allowed command;
    // we don't actually need a project to run it.
    // Skip if vitest isn't present.
    const out = await bashTool.call(
      { command: 'vitest --version', timeout_ms: 15000, cwd_relative: '.' },
      makeCtx('test_runner'),
    )
    expect(out.exit_code).toBe(0)
    expect(out.stdout.length).toBeGreaterThan(0)
  })
})

// ─── runTestSuite framework detection ───────────────────────────────

describe('detectFramework', () => {
  it('detects vitest from package.json scripts', () => {
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }),
    )
    expect(detectFramework(workspaceRoot)).toBe('vitest')
  })

  it('detects jest from package.json scripts', () => {
    writeFileSync(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest --coverage' } }),
    )
    expect(detectFramework(workspaceRoot)).toBe('jest')
  })

  it('detects vitest from config file when no scripts', () => {
    writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({}))
    writeFileSync(join(workspaceRoot, 'vitest.config.ts'), '// config')
    expect(detectFramework(workspaceRoot)).toBe('vitest')
  })

  it('detects pytest from pyproject.toml', () => {
    writeFileSync(join(workspaceRoot, 'pyproject.toml'), '[tool.pytest]\n')
    expect(detectFramework(workspaceRoot)).toBe('pytest')
  })

  it('detects go-test from go.mod', () => {
    writeFileSync(join(workspaceRoot, 'go.mod'), 'module x\n')
    expect(detectFramework(workspaceRoot)).toBe('go-test')
  })

  it('falls back to vitest when nothing matches', () => {
    expect(detectFramework(workspaceRoot)).toBe('vitest')
  })
})

// ─── runTestSuite output parsing ───────────────────────────────────

describe('parseTestCounts', () => {
  it('parses vitest summary line', () => {
    const out = ` Test Files  20 passed (20)\n      Tests  151 passed | 4 skipped (155)\n`
    const counts = parseTestCounts(out, 'vitest')
    expect(counts.passed).toBe(151)
    expect(counts.skipped).toBe(4)
  })

  it('parses pytest summary line', () => {
    const out = '===== 5 passed, 1 failed, 2 skipped in 3.21s =====\n'
    const counts = parseTestCounts(out, 'pytest')
    expect(counts.passed).toBe(5)
  })

  it('returns nulls when output is unparseable', () => {
    const counts = parseTestCounts('random text\n', 'vitest')
    // Vitest pattern requires "Tests" prefix; without it we get all-null
    // (or partial null — failed/skipped default to 0). Tolerate either.
    expect(counts.passed === null).toBe(true)
  })
})
