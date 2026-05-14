// bash tool — sandboxed shell command runner.
//
// SECURITY MODEL (rewritten after self-review found the original
// `shell: true` + regex-prefix check could be bypassed by command
// substitution `$()`, command chaining `;`, `&&`, `||`, etc.):
//
//   1. Input string parsed into argv (whitespace split, no quoting).
//   2. Every argv token must match TOKEN_PATTERN — rejects all shell
//      metacharacters (; & | < > $ ` \ \n ( ) { } [ ] * ? ! # ~ ").
//   3. argv[0] must be in EXECUTABLE_ALLOWLIST.
//   4. argv[1..] is further constrained based on argv[0] (e.g.
//      `npm`/`pnpm`/`yarn`/`bun` must have `test` or `t` second).
//   5. spawn() with `shell: false` and a stripped env (PATH + a few
//      locale vars only). NO process.env passthrough.

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { z } from 'zod'
import { buildTool, ToolError } from './ToolDef.js'

const MAX_OUTPUT_BYTES = 50 * 1024 // 50 KB per stream
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000

// Every argv token must match this. No shell metacharacters allowed.
// Letters, digits, dots, dashes, slashes, underscores, =, :, @, comma.
const TOKEN_PATTERN = /^[A-Za-z0-9._\-/:@=,]+$/

// First-argument allowlist.
const EXECUTABLE_ALLOWLIST = new Set<string>([
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'pnpx',
  'bunx',
  'vitest',
  'jest',
  'pytest',
  'go',
])

/**
 * Parse + validate a command into argv. Throws ToolError on rejection.
 */
function parseAndValidate(trimmed: string): string[] {
  // Reject if any obvious metachar appears (defense in depth — the
  // per-token TOKEN_PATTERN check below catches them too, but a
  // single early reject is clearer in error messages).
  if (/[;&|<>$`\\\n()'"{}*?!#~\[\]]/.test(trimmed)) {
    throw new ToolError(
      'sandbox_violation',
      'bash',
      `Shell metacharacters not allowed in bash tool commands. Got: ${trimmed.slice(0, 100)}`,
      false,
      { command: trimmed },
    )
  }
  const argv = trimmed.split(/\s+/).filter(Boolean)
  if (argv.length === 0) {
    throw new ToolError('invalid_input', 'bash', 'Empty command.', false)
  }
  for (const tok of argv) {
    if (!TOKEN_PATTERN.test(tok)) {
      throw new ToolError(
        'sandbox_violation',
        'bash',
        `Token "${tok.slice(0, 40)}" contains characters not in the safe set.`,
        false,
        { command: trimmed },
      )
    }
  }
  const exe = argv[0]!
  if (!EXECUTABLE_ALLOWLIST.has(exe)) {
    throw new ToolError(
      'sandbox_violation',
      'bash',
      `Executable "${exe}" not in allowlist (${[...EXECUTABLE_ALLOWLIST].join(', ')}).`,
      false,
      { command: trimmed },
    )
  }
  // Per-executable arg constraint — argv[1] must indicate a test
  // run for npm-family / go / pnpx-family. vitest|jest|pytest are
  // already test runners as the executable, no constraint needed.
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(exe)) {
    const a1 = argv[1]
    const a2 = argv[2]
    const isTestVerb = (s: string | undefined): boolean =>
      s === 'test' || s === 't'
    if (!isTestVerb(a1) && !(a1 === 'run' && isTestVerb(a2))) {
      throw new ToolError(
        'sandbox_violation',
        'bash',
        `${exe} only accepts test commands (e.g. "${exe} test" or "${exe} run test"). Got: ${trimmed.slice(0, 100)}`,
        false,
      )
    }
  }
  if (['npx', 'pnpx', 'bunx'].includes(exe)) {
    const a1 = argv[1]
    if (!a1 || !['vitest', 'jest', 'mocha', 'playwright'].includes(a1)) {
      throw new ToolError(
        'sandbox_violation',
        'bash',
        `${exe} only allowed for vitest|jest|mocha|playwright. Got: ${trimmed.slice(0, 100)}`,
        false,
      )
    }
  }
  if (exe === 'go') {
    if (argv[1] !== 'test') {
      throw new ToolError(
        'sandbox_violation',
        'bash',
        'go is only allowed for `go test ...`.',
        false,
      )
    }
  }
  return argv
}

// Stripped environment for the sandboxed process. PATH is forwarded
// (the spawned executable needs it), plus a few locale vars to keep
// output sane. NOTHING that holds a secret (AWS_*, GITHUB_TOKEN,
// OPENAI_API_KEY, etc.) is propagated.
function buildSandboxEnv(): NodeJS.ProcessEnv {
  const PATH_VAR = process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin'
  return {
    PATH: PATH_VAR,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    LC_ALL: process.env.LC_ALL ?? 'en_US.UTF-8',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    NODE_ENV: 'test',
    // Force npm/pnpm/yarn into non-interactive mode so they don't
    // pop login prompts or block on tty checks.
    CI: '1',
  }
}

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
    // parseAndValidate throws ToolError on any rejection.
    const argv = parseAndValidate(trimmed)

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

    return runShellCommand(argv, {
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
  argv: string[],
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
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: opts.cwd,
      // shell: false so no shell parsing happens. argv was already
      // validated (no metachars, exe in allowlist).
      shell: false,
      env: buildSandboxEnv(),
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
