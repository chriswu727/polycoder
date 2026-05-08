// Test Coverage Maintenance Rate (TCMR).
//
// For each iter snapshot:
//   - if package.json scripts.test exists: run it, capture exit code
//   - else: na
//
// TCMR is polycoder-internal in the IST: only polycoder-full produces
// tests by default (Test Runner role). For systems that don't, TCMR
// reports na (applicable=false) and the IST aggregator excludes them
// from headline numbers.
//
// Spec: docs/specs/iteration-survival-test.md §6.3.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { TCMR } from './types.js'

const TEST_TIMEOUT_MS = 120_000

export type TCMRArgs = {
  /** Working directory containing package.json + node_modules. */
  work_dir: string
}

export async function computeTCMR(args: TCMRArgs): Promise<TCMR> {
  const start = Date.now()
  const pkgPath = join(args.work_dir, 'package.json')

  if (!existsSync(pkgPath)) {
    return {
      status: 'na',
      applicable: false,
      applicable_reason: 'no package.json',
      test_command: null,
      exit_code: null,
      duration_ms: Date.now() - start,
    }
  }

  let pkg: { scripts?: Record<string, string> } = {}
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg
  } catch {
    return {
      status: 'error',
      applicable: false,
      applicable_reason: 'package.json unparseable',
      test_command: null,
      exit_code: null,
      duration_ms: Date.now() - start,
    }
  }

  const testScript = pkg.scripts?.test
  if (!testScript) {
    return {
      status: 'na',
      applicable: false,
      applicable_reason: 'package.json has no scripts.test',
      test_command: null,
      exit_code: null,
      duration_ms: Date.now() - start,
    }
  }

  // Skip the placeholder npm-init default.
  if (/no test specified/i.test(testScript)) {
    return {
      status: 'na',
      applicable: false,
      applicable_reason: 'scripts.test is the npm-init placeholder ("no test specified")',
      test_command: testScript,
      exit_code: null,
      duration_ms: Date.now() - start,
    }
  }

  const useNpm = !existsSync(join(args.work_dir, 'pnpm-lock.yaml'))
  const cmd = useNpm ? 'npm' : 'pnpm'
  const argv = useNpm ? ['test', '--', '--run'] : ['test']

  const r = await runWithTimeout(cmd, argv, args.work_dir, TEST_TIMEOUT_MS)
  if (r.timedOut) {
    return {
      status: 'fail',
      applicable: true,
      applicable_reason: `${cmd} test timed out after ${TEST_TIMEOUT_MS}ms`,
      test_command: `${cmd} ${argv.join(' ')}`,
      exit_code: null,
      duration_ms: Date.now() - start,
      stdout_tail: r.stdout_tail,
    }
  }

  return {
    status: r.exit_code === 0 ? 'pass' : 'fail',
    applicable: true,
    applicable_reason: r.exit_code === 0 ? 'tests passed' : `tests failed (exit ${r.exit_code})`,
    test_command: `${cmd} ${argv.join(' ')}`,
    exit_code: r.exit_code,
    duration_ms: Date.now() - start,
    stdout_tail: r.stdout_tail,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

type SpawnResult = {
  exit_code: number | null
  timedOut: boolean
  stdout_tail: string
}

function runWithTimeout(
  cmd: string,
  argv: string[],
  cwd: string,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, {
      cwd,
      shell: false,
      env: { ...process.env, CI: '1' },
    })

    let buf = ''
    const cap = (chunk: Buffer): void => {
      buf += chunk.toString()
      if (buf.length > 8000) buf = buf.slice(-8000)
    }
    child.stdout?.on('data', cap)
    child.stderr?.on('data', cap)

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.on('error', (e) => {
      clearTimeout(timer)
      buf += `\n[spawn error] ${String(e)}`
      resolve({ exit_code: null, timedOut, stdout_tail: buf.slice(-2000) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exit_code: code, timedOut, stdout_tail: buf.slice(-2000) })
    })
  })
}
