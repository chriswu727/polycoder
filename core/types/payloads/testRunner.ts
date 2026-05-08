// Test Runner role payload — see docs/prompts/07-test-runner.md §6.

import { z } from 'zod'

const TestWrittenSchema = z.object({
  file: z.string(),
  action: z.enum(['create', 'edit']),
  covers: z.array(z.string()).default([]),
  content_or_diff: z.string().optional(),
})

const TestRunSchema = z.object({
  command: z.string(),
  exit_code: z.number().int(),
  output_summary: z.string(),
  passed_count: z.number().int().nullable().default(null),
  failed_count: z.number().int().nullable().default(null),
  skipped_count: z.number().int().nullable().default(null),
  duration_ms: z.number().int(),
})

const FailureSchema = z.object({
  test_name: z.string(),
  file: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  implication: z.string(),
})

const CoverageAssessmentSchema = z.object({
  covered_paths: z.array(z.string()).default([]),
  uncovered_paths: z.array(z.string()).default([]),
  coverage_adequacy: z
    .enum(['good', 'sparse', 'inadequate'])
    .default('sparse'),
  blockers_for_full_coverage: z.array(z.string()).default([]),
})

export const TestRunnerPayloadSchema = z
  .object({
    tests_written: z.array(TestWrittenSchema).default([]),
    test_run: TestRunSchema.nullable().default(null),
    failures: z.array(FailureSchema).default([]),
    coverage_assessment: CoverageAssessmentSchema.optional(),
    follow_up_for_coder: z.array(z.string()).default([]),
  })
  .passthrough()

export type TestRunnerPayload = z.infer<typeof TestRunnerPayloadSchema>
