// Cyclomatic Complexity Drift (CCD).
//
// For each iter snapshot, run ESLint with the `complexity` rule
// (threshold 0 → emit a message for every function). Parse the
// JSON output to extract per-function cyclomatic complexity, then
// compute mean + max across the snapshot.
//
// `drift_from_iter1` is `mean(N) - mean(1)` — set by the metrics
// runner once iter 1 has been computed for the same (system,
// template).
//
// Spec: docs/specs/iteration-survival-test.md §6.4.

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

import type { CCD } from './types.js'

const ESLINT_TIMEOUT_MS = 60_000
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

export type CCDArgs = {
  /** Snapshot directory. */
  snapshot_dir: string
  /** Optional path to the ESLint binary; default 'eslint'. */
  eslintBin?: string
}

export async function computeCCD(args: CCDArgs): Promise<CCD> {
  const start = Date.now()

  const sources = await collectSourceFiles(args.snapshot_dir)
  if (sources.length === 0) {
    return {
      status: 'na',
      applicable: false,
      applicable_reason: 'no .ts/.tsx/.js/.jsx files in snapshot',
      files_analyzed: 0,
      mean_complexity: null,
      max_complexity: null,
      drift_from_iter1: null,
      duration_ms: Date.now() - start,
    }
  }

  const eslintBin = args.eslintBin ?? 'eslint'
  const r = await runEslintComplexity(eslintBin, sources, args.snapshot_dir)
  if (r.error) {
    return {
      status: 'error',
      applicable: true,
      applicable_reason: `eslint ${r.error}`,
      files_analyzed: sources.length,
      mean_complexity: null,
      max_complexity: null,
      drift_from_iter1: null,
      duration_ms: Date.now() - start,
    }
  }

  const complexities = extractComplexityValues(r.json)
  if (complexities.length === 0) {
    return {
      status: 'pass',
      applicable: true,
      applicable_reason: 'no functions found in source files (e.g., declarative-only TS)',
      files_analyzed: sources.length,
      mean_complexity: 0,
      max_complexity: 0,
      drift_from_iter1: null,
      duration_ms: Date.now() - start,
    }
  }

  const mean = complexities.reduce((a, b) => a + b, 0) / complexities.length
  const max = Math.max(...complexities)
  return {
    status: 'pass',
    applicable: true,
    applicable_reason: `analyzed ${complexities.length} functions across ${sources.length} files`,
    files_analyzed: sources.length,
    mean_complexity: Number(mean.toFixed(2)),
    max_complexity: max,
    drift_from_iter1: null,
    duration_ms: Date.now() - start,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function collectSourceFiles(root: string): Promise<string[]> {
  return Promise.resolve(walk(root))
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next'])

function walk(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(full)
      } else if (st.isFile() && SOURCE_EXTS.has(extname(name))) {
        out.push(full)
      }
    }
  }
  // Stable order for reproducibility (relative path).
  out.sort((a, b) => relative(root, a).localeCompare(relative(root, b)))
  return out
}

type EslintMessage = {
  ruleId: string | null
  message: string
}
type EslintFileReport = {
  filePath: string
  messages: EslintMessage[]
}

type EslintRunResult = {
  json: EslintFileReport[]
  error: string | null
}

function runEslintComplexity(
  bin: string,
  absoluteFiles: string[],
  cwd: string,
): Promise<EslintRunResult> {
  return new Promise((resolve) => {
    // Run from cwd = snapshot root; ESLint's base-path rule then
    // accepts the files because they're inside cwd. Pass relative
    // paths to keep the JSON output compact.
    const relFiles = absoluteFiles.map((f) => relative(cwd, f))
    const argv = [
      '--no-config-lookup',
      '--no-ignore',
      '--no-error-on-unmatched-pattern',
      '--rule',
      JSON.stringify({ complexity: ['warn', { max: 0 }] }),
      '--format',
      'json',
      ...relFiles,
    ]

    const child = spawn(bin, argv, { cwd, shell: false, env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString()))
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()))

    const timer = setTimeout(() => child.kill('SIGKILL'), ESLINT_TIMEOUT_MS)
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ json: [], error: `spawn error: ${String(e)}` })
    })
    child.on('close', (_code) => {
      clearTimeout(timer)
      // ESLint exits non-zero when *any* rule fires. We expect that —
      // every function over complexity 0 produces a message. So we
      // ignore the exit code and parse stdout regardless.
      try {
        const parsed = JSON.parse(stdout) as EslintFileReport[]
        resolve({ json: parsed, error: null })
      } catch (e) {
        resolve({
          json: [],
          error: `unparseable output (stderr tail: ${stderr.slice(-300)}): ${String(e).slice(0, 300)}`,
        })
      }
    })
  })
}

function extractComplexityValues(reports: EslintFileReport[]): number[] {
  const out: number[] = []
  for (const f of reports) {
    for (const m of f.messages) {
      if (m.ruleId === 'complexity') {
        // Message format: 'Function ... has a complexity of N.'
        const match = m.message.match(/complexity of (\d+)/i)
        if (match) out.push(Number.parseInt(match[1]!, 10))
      }
    }
  }
  return out
}
