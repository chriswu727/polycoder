// run_test_suite tool — higher-level wrapper around bash that
// detects the project's test framework and runs the right command.
// Per docs/specs/tools.md §4.10.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { buildTool } from './ToolDef.js'
import { runShellCommand } from './bash.js'

export const RunTestSuiteInputSchema = z.object({
  scope: z.enum(['all', 'changed_files', 'specific']).default('all'),
  specific_files: z.array(z.string()).optional(),
  framework_override: z
    .enum(['vitest', 'jest', 'pytest', 'go-test', 'bun-test'])
    .optional(),
})

export const RunTestSuiteOutputSchema = z.object({
  command_used: z.string(),
  framework_detected: z.string(),
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  passed_count: z.number().int().nullable(),
  failed_count: z.number().int().nullable(),
  skipped_count: z.number().int().nullable(),
  duration_ms: z.number().int(),
})

const FRAMEWORK_COMMANDS: Record<string, string> = {
  vitest: 'pnpm vitest run',
  jest: 'pnpm jest',
  pytest: 'pytest',
  'go-test': 'go test ./...',
  'bun-test': 'bun test',
}

export const runTestSuiteTool = buildTool({
  name: 'run_test_suite',
  description:
    'Detect the project\'s test framework and run the appropriate command. Returns parsed pass/fail/skip counts when possible. Test Runner role only.',
  inputSchema: RunTestSuiteInputSchema,
  outputSchema: RunTestSuiteOutputSchema,
  allowedRoles: ['test_runner'],

  async call(input, ctx) {
    const framework =
      input.framework_override ?? detectFramework(ctx.workspace_root)
    const baseCmd = FRAMEWORK_COMMANDS[framework] ?? 'pnpm test'

    // baseCmd is a string like "pnpm test" — split into argv. Specific
    // files (if any) are appended as separate argv tokens.
    const argv = baseCmd.split(/\s+/).filter(Boolean)
    if (
      input.scope === 'specific' &&
      input.specific_files &&
      input.specific_files.length > 0
    ) {
      argv.push(...input.specific_files)
    }
    const command = argv.join(' ')

    const result = await runShellCommand(argv, {
      cwd: ctx.workspace_root,
      timeout_ms: 180_000,
      abort_signal: ctx.abort_signal,
    })

    const counts = parseTestCounts(result.stdout + '\n' + result.stderr, framework)

    return {
      command_used: command,
      framework_detected: framework,
      exit_code: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr,
      passed_count: counts.passed,
      failed_count: counts.failed,
      skipped_count: counts.skipped,
      duration_ms: result.duration_ms,
    }
  },
})

export function detectFramework(workspaceRoot: string): string {
  // package.json test script
  const pkgPath = join(workspaceRoot, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>
      }
      const testScript = pkg.scripts?.test ?? ''
      if (/vitest/.test(testScript)) return 'vitest'
      if (/jest/.test(testScript)) return 'jest'
      if (/bun\s+test/.test(testScript)) return 'bun-test'
    } catch {
      // ignore — fallthrough to other detection
    }
  }

  // Config-file detection
  if (
    ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs'].some((f) =>
      existsSync(join(workspaceRoot, f)),
    )
  )
    return 'vitest'
  if (
    ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.json'].some((f) =>
      existsSync(join(workspaceRoot, f)),
    )
  )
    return 'jest'
  if (existsSync(join(workspaceRoot, 'pyproject.toml')) || existsSync(join(workspaceRoot, 'pytest.ini')))
    return 'pytest'
  if (existsSync(join(workspaceRoot, 'go.mod'))) return 'go-test'

  // Default fallback.
  return 'vitest'
}

export function parseTestCounts(
  output: string,
  framework: string,
): { passed: number | null; failed: number | null; skipped: number | null } {
  // Vitest: " Tests  X passed | Y failed | Z skipped (N)"
  if (framework === 'vitest') {
    const m = output.match(/Tests\s+(?:(\d+)\s+passed)?(?:.*?(\d+)\s+failed)?(?:.*?(\d+)\s+skipped)?/)
    if (m) {
      return {
        passed: m[1] ? parseInt(m[1], 10) : null,
        failed: m[2] ? parseInt(m[2], 10) : 0,
        skipped: m[3] ? parseInt(m[3], 10) : 0,
      }
    }
  }
  if (framework === 'jest') {
    const passed = output.match(/(\d+)\s+passed/)
    const failed = output.match(/(\d+)\s+failed/)
    const skipped = output.match(/(\d+)\s+(skipped|todo)/)
    return {
      passed: passed?.[1] ? parseInt(passed[1], 10) : null,
      failed: failed?.[1] ? parseInt(failed[1], 10) : null,
      skipped: skipped?.[1] ? parseInt(skipped[1], 10) : null,
    }
  }
  if (framework === 'pytest') {
    const m = output.match(/(\d+)\s+passed.*?(\d+)?\s*failed?.*?(\d+)?\s*skipped?/)
    return {
      passed: m?.[1] ? parseInt(m[1], 10) : null,
      failed: m?.[2] ? parseInt(m[2], 10) : 0,
      skipped: m?.[3] ? parseInt(m[3], 10) : 0,
    }
  }
  return { passed: null, failed: null, skipped: null }
}
