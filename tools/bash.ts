// bash tool — sandboxed shell command runner. V0 restriction:
// Test Runner role only, and only commands matching the
// SAFE_COMMAND_PATTERNS allowlist (test runners, primarily).
// Per docs/specs/tools.md §4.4.

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { z } from 'zod'
import { buildTool, ToolError } from './ToolDef.js'

const MAX_OUTPUT_BYTES = 50 * 1024 // 50 KB per stream
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000

/**
 * V0 sandbox allowlist: regex patterns for shell commands the bash
 * tool will execute. Anything else is rejected with sandbox_violation.
 *
 * The regexes are tested against the leading whitespace-trimmed
 * command (e.g. `bun test`, `npx vitest`). Subsequent arguments are
 * not constrained — Test Runner can pass paths and flags freely.
 */
export const SAFE_COMMAND_PATTERNS: RegExp[] = [
  /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t)(\s|$)/,
  /^(npx|pnpx|bunx)\s+(vitest|jest|mocha|playwright)\b/,
  /^(vitest|jest)\b/,
  /^pytest\b/,
  /^go\s+test\b/,
]

export const BashInputSchema = z.object({
  command: z.string().min(1),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_MS)
    .default(DEFAULT_TIMEOUT_MS),
  cwd_relative: z.string().default('.'),
})

export const BashOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exit_code: z.number().int(),
  duration_ms: z.number().int(),
  truncated_stdout: z.boolean(),
  truncated_stderr: z.boolean(),
})

export const bashTool = buildTool({
  name: 'bash',
  description:
    'Run a sandboxed shell command. V0 only allows test-runner commands (npm/pnpm/yarn/bun test, vitest, jest, pytest, go test). Anything else is rejected with sandbox_violation. cwd_relative is resolved against the workspace root. Output capped at 50KB per stream.',
  inputSchema: BashInputSchema,
  outputSchema: BashOutputSchema,
  allowedRoles: ['test_runner'],

  async call(input, ctx) {
    const trimmed = input.command.trim()
    if (!SAFE_COMMAND_PATTERNS.some((p) => p.test(trimmed))) {
      throw new ToolError(
        'sandbox_violation',
        'bash',
        `Command rejected by sandbox: "${trimmed.slice(0, 100)}". Allowed prefixes: npm/pnpm/yarn/bun test, npx vitest|jest|mocha|playwright, vitest, jest, pytest, go test.`,
        false,
        { command: trimmed },
      )
    }

    // cwd resolution: must stay inside workspace_root
    const root = resolve(ctx.workspace_root)
    const cwd = resolve(root, input.cwd_relative)
    if (!cwd.startsWith(root)) {
      throw new ToolError(
        'workspace_violation',
        'bash',
        `cwd_relative escapes workspace: ${input.cwd_relative}`,
        false,
      )
    }

    return runShellCommand(trimmed, {
      cwd,
      timeout_ms: input.timeout_ms,
      abort_signal: ctx.abort_signal,
    })
  },
})

export type RunShellOptions = {
  cwd: string
  timeout_ms: number
  abort_signal: AbortSignal
}

export async function runShellCommand(
  command: string,
  opts: RunShellOptions,
): Promise<{
  stdout: string
  stderr: string
  exit_code: number
  duration_ms: number
  truncated_stdout: boolean
  truncated_stderr: boolean
}> {
  const start = Date.now()
  return new Promise((resolveProm) => {
    const child = spawn(command, [], {
      cwd: opts.cwd,
      shell: true,
      env: { ...process.env, NODE_ENV: 'test' },
    })

    let stdout = ''
    let stderr = ''
    let truncStdout = false
    let truncStderr = false

    child.stdout?.on('data', (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(stdout, 'utf8')
      if (remaining <= 0) {
        truncStdout = true
        return
      }
      const text = chunk.toString('utf8')
      const sizeNew = Buffer.byteLength(text, 'utf8')
      if (sizeNew <= remaining) {
        stdout += text
      } else {
        stdout += text.slice(0, remaining)
        truncStdout = true
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(stderr, 'utf8')
      if (remaining <= 0) {
        truncStderr = true
        return
      }
      const text = chunk.toString('utf8')
      const sizeNew = Buffer.byteLength(text, 'utf8')
      if (sizeNew <= remaining) {
        stderr += text
      } else {
        stderr += text.slice(0, remaining)
        truncStderr = true
      }
    })

    const timeoutHandle = setTimeout(() => {
      child.kill('SIGTERM')
      // Give it a moment, then SIGKILL.
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 1000)
    }, opts.timeout_ms)

    const onAbort = () => {
      clearTimeout(timeoutHandle)
      child.kill('SIGTERM')
    }
    if (opts.abort_signal.aborted) onAbort()
    else opts.abort_signal.addEventListener('abort', onAbort, { once: true })

    child.on('close', (code) => {
      clearTimeout(timeoutHandle)
      opts.abort_signal.removeEventListener('abort', onAbort)
      resolveProm({
        stdout,
        stderr,
        exit_code: code ?? -1,
        duration_ms: Date.now() - start,
        truncated_stdout: truncStdout,
        truncated_stderr: truncStderr,
      })
    })

    child.on('error', () => {
      clearTimeout(timeoutHandle)
      opts.abort_signal.removeEventListener('abort', onAbort)
      resolveProm({
        stdout,
        stderr,
        exit_code: -1,
        duration_ms: Date.now() - start,
        truncated_stdout: truncStdout,
        truncated_stderr: truncStderr,
      })
    })
  })
}
