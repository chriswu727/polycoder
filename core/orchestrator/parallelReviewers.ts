// runParallelReviewers — fans out the three parallel-phase roles
// (Adversary, Long-term Critic, Test Runner) and awaits all of
// them. Does NOT fail-fast: even if one reviewer fails, the others
// still run and the orchestrator gets partial results.
//
// Per docs/specs/orchestrator.md §4.

import type { InvokeRoleArgs, InvokeRoleResult } from '../roleHarness/invokeRole.js'
import { invokeRole } from '../roleHarness/invokeRole.js'

export type RunParallelReviewersArgs = {
  /**
   * Factory: orchestrator-supplied function that produces a fresh
   * InvokeRoleArgs for the given reviewer role. Lets the caller
   * thread provider, model, ctx, and prompt inputs without us
   * needing to know about Workspace structure here.
   */
  buildArgsForRole: (role: 'adversary' | 'long_term_critic' | 'test_runner') => InvokeRoleArgs
}

export type ParallelReviewersResult = {
  adversary: InvokeRoleResult
  long_term_critic: InvokeRoleResult
  test_runner: InvokeRoleResult
}

export async function runParallelReviewers(
  args: RunParallelReviewersArgs,
): Promise<ParallelReviewersResult> {
  const [adversary, long_term_critic, test_runner] = await Promise.all([
    invokeRole(args.buildArgsForRole('adversary')),
    invokeRole(args.buildArgsForRole('long_term_critic')),
    invokeRole(args.buildArgsForRole('test_runner')),
  ])
  return { adversary, long_term_critic, test_runner }
}
