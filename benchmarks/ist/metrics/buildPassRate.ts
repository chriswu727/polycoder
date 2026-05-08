// Build Pass Rate (BPR). For each iter snapshot:
//   - if package.json exists with a build script:
//       run install + build, check that some build output dir
//       (dist/ build/ out/) contains an index.html
//   - else:
//       check that index.html exists at the snapshot root
//
// Spec: docs/specs/iteration-survival-test.md §6.1.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { BPR } from './types.js'

const BUILD_OUTPUT_DIRS = ['dist', 'build', 'out', '.next/static', 'public']
const INDEX_FILES = ['index.html', 'index.htm']

const INSTALL_TIMEOUT_MS = 120_000
const BUILD_TIMEOUT_MS = 120_000

export type BPRArgs = {
  /** Snapshot directory whose contents are the iter's source. */
  snapshot_dir: string
  /** Working directory to perform install+build in (typically a tmp
   *  copy of snapshot_dir so node_modules don't pollute the snapshot). */
  work_dir: string
}

export async function computeBPR(args: BPRArgs): Promise<BPR> {
  const start = Date.now()
  const pkgPath = join(args.work_dir, 'package.json')

  if (!existsSync(pkgPath)) {
    // Static path: index.html at root must exist + be non-empty.
    const idx = findIndexAtRoot(args.work_dir)
    if (!idx) {
      return {
        status: 'fail',
        applicable: true,
        applicable_reason: 'static — no package.json, no index.html at root',
        build_kind: 'static',
        exit_code: null,
        duration_ms: Date.now() - start,
        served_dir: null,
      }
    }
    return {
      status: 'pass',
      applicable: true,
      applicable_reason: `static — package.json absent, index.html (${statSync(idx).size}B) present`,
      build_kind: 'static',
      exit_code: 0,
      duration_ms: Date.now() - start,
      served_dir: args.work_dir,
    }
  }

  // Build path.
  let pkg: { scripts?: Record<string, string> } = {}
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg
  } catch {
    return {
      status: 'fail',
      applicable: true,
      applicable_reason: 'package.json present but unparseable',
      build_kind: 'pnpm',
      exit_code: null,
      duration_ms: Date.now() - start,
      served_dir: null,
    }
  }

  const buildScript = pkg.scripts?.build
  if (!buildScript) {
    // No build script — treat as static if index.html exists at root.
    const idx = findIndexAtRoot(args.work_dir)
    if (idx) {
      return {
        status: 'pass',
        applicable: true,
        applicable_reason: 'package.json present without build script; index.html at root',
        build_kind: 'static',
        exit_code: 0,
        duration_ms: Date.now() - start,
        served_dir: args.work_dir,
      }
    }
    return {
      status: 'fail',
      applicable: true,
      applicable_reason: 'package.json present without build script and no index.html at root',
      build_kind: 'none',
      exit_code: null,
      duration_ms: Date.now() - start,
      served_dir: null,
    }
  }

  const useNpm = !existsSync(join(args.work_dir, 'pnpm-lock.yaml'))
  const buildKind: BPR['build_kind'] = useNpm ? 'npm' : 'pnpm'

  // Install
  const install = await runWithTimeout(
    useNpm ? 'npm' : 'pnpm',
    useNpm ? ['install', '--no-audit', '--no-fund'] : ['install', '--no-frozen-lockfile'],
    args.work_dir,
    INSTALL_TIMEOUT_MS,
  )
  if (install.timedOut || install.exit_code !== 0) {
    return {
      status: 'fail',
      applicable: true,
      applicable_reason: `${useNpm ? 'npm' : 'pnpm'} install ${install.timedOut ? 'timed out' : `exited ${install.exit_code}`}`,
      build_kind: buildKind,
      exit_code: install.exit_code,
      duration_ms: Date.now() - start,
      stdout_tail: install.stdout_tail,
      stderr_tail: install.stderr_tail,
      served_dir: null,
    }
  }

  // Build
  const build = await runWithTimeout(
    useNpm ? 'npm' : 'pnpm',
    useNpm ? ['run', 'build'] : ['run', 'build'],
    args.work_dir,
    BUILD_TIMEOUT_MS,
  )
  if (build.timedOut || build.exit_code !== 0) {
    return {
      status: 'fail',
      applicable: true,
      applicable_reason: `${useNpm ? 'npm' : 'pnpm'} run build ${build.timedOut ? 'timed out' : `exited ${build.exit_code}`}`,
      build_kind: buildKind,
      exit_code: build.exit_code,
      duration_ms: Date.now() - start,
      stdout_tail: build.stdout_tail,
      stderr_tail: build.stderr_tail,
      served_dir: null,
    }
  }

  // Locate the served directory (first build-output dir with an index.html).
  for (const dir of BUILD_OUTPUT_DIRS) {
    const full = join(args.work_dir, dir)
    if (findIndexAtRoot(full)) {
      return {
        status: 'pass',
        applicable: true,
        applicable_reason: `${useNpm ? 'npm' : 'pnpm'} build OK; output at ${dir}/`,
        build_kind: buildKind,
        exit_code: 0,
        duration_ms: Date.now() - start,
        served_dir: full,
      }
    }
  }

  return {
    status: 'fail',
    applicable: true,
    applicable_reason: 'build exited 0 but no index.html in dist/ build/ out/',
    build_kind: buildKind,
    exit_code: 0,
    duration_ms: Date.now() - start,
    stdout_tail: build.stdout_tail,
    stderr_tail: build.stderr_tail,
    served_dir: null,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function findIndexAtRoot(dir: string): string | null {
  if (!existsSync(dir)) return null
  for (const f of INDEX_FILES) {
    const p = join(dir, f)
    if (existsSync(p) && statSync(p).size > 0) return p
  }
  return null
}

type SpawnResult = {
  exit_code: number | null
  timedOut: boolean
  stdout_tail: string
  stderr_tail: string
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

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.length > 8000) stdout = stdout.slice(-8000)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.on('error', (e) => {
      clearTimeout(timer)
      stderr += `\n[spawn error] ${String(e)}`
      resolve({
        exit_code: null,
        timedOut,
        stdout_tail: stdout.slice(-2000),
        stderr_tail: stderr.slice(-2000),
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        exit_code: code,
        timedOut,
        stdout_tail: stdout.slice(-2000),
        stderr_tail: stderr.slice(-2000),
      })
    })
  })
}
