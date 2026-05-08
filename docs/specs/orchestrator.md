# Pipeline Orchestrator — Implementation Spec

> **Status**: Design contract. Implementation has not started.
> **Related**: ADR-007 (Coordinator/Worker pattern), ADR-009 (cache
> boundary), ADR-010 (XML envelopes), ADR-011 (verification
> independence), ADR-012 (synthesis discipline).
> **Sister specs**: [`providers.md`](./providers.md),
> [`tools.md`](./tools.md)

---

## 1. What the orchestrator is

The single entity that:

1. Takes a user prompt + workspace state
2. Runs the 8 roles in the correct order (sequential 1-4, parallel 5-7,
   sequential 8)
3. Validates each role's output envelope
4. Detects conflicts across roles
5. Decides whether to retry a role, surface a conflict to the user,
   or proceed
6. Aggregates cost, duration, and telemetry
7. Returns the final Communicator output for UI rendering

The orchestrator is **pure logic**. It owns no LLM calls of its own
(those go through provider adapters). It owns no UI rendering
(Communicator's output is the only user-facing artifact).

---

## 2. Pipeline state machine

### 2.1 States

```
        ┌──────────────────┐
        │  ITERATION_START │
        └────────┬─────────┘
                 ▼
        ┌──────────────────┐
        │   TRANSLATING    │  ← Role 1
        └────────┬─────────┘
                 ▼
   needs clarification?
                 ├── yes ──► ┌──────────────────┐
                 │           │  AWAITING_USER   │ ── timeout / answer
                 │           └────────┬─────────┘
                 │                    │
                 ▼                    ▼
        ┌──────────────────┐
        │    DESIGNING     │  ← Role 2
        └────────┬─────────┘
                 ▼
        ┌──────────────────┐
        │   ARCHITECTING   │  ← Role 3
        └────────┬─────────┘
                 ▼
   conflict_detected?
                 ├── yes ──► ┌──────────────────┐
                 │           │ AWAITING_USER    │
                 │           │   (conflict)     │
                 │           └──────────────────┘
                 ▼
        ┌──────────────────┐
        │     CODING       │  ← Role 4
        └────────┬─────────┘
                 ▼
        ┌──────────────────────────────────────┐
        │  PARALLEL: ADVERSARY ‖ LONG_TERM ‖   │  ← Roles 5, 6, 7
        │           TEST_RUNNER                │
        └────────┬─────────────────────────────┘
                 ▼
        ┌──────────────────┐
        │ CONFLICT_DETECT  │  ← orchestrator logic, no LLM
        └────────┬─────────┘
                 ▼
        ┌──────────────────┐
        │  COMMUNICATING   │  ← Role 8
        └────────┬─────────┘
                 ▼
        ┌──────────────────┐
        │   ITERATION_END  │
        └──────────────────┘
```

Plus terminal states: `ABORTED` (user cancellation), `FAILED`
(unrecoverable error), `COMPLETED`.

### 2.2 State transitions are events

```typescript
type PipelineEvent =
  | { type: 'iteration_started', iteration_id: string, user_prompt: string }
  | { type: 'role_started', role: RoleType, model: string }
  | { type: 'role_completed', role: RoleType, envelope: RoleOutput }
  | { type: 'role_failed', role: RoleType, error: PipelineError }
  | { type: 'role_retried', role: RoleType, attempt: number, reason: string }
  | { type: 'awaiting_user', prompt: string, options?: string[] }
  | { type: 'user_responded', response: string }
  | { type: 'conflict_detected', conflict: RoleConflict }
  | { type: 'iteration_completed', summary: CommunicatorOutput }
  | { type: 'iteration_aborted', reason: string }
  | { type: 'iteration_failed', error: PipelineError }
  | { type: 'cost_update', cumulative_usd: number }
```

Events are emitted to subscribers (UI, telemetry, persistence layer)
as the pipeline runs. The state machine itself is the source of truth.

---

## 3. Role invocation

```typescript
async function invokeRole<R extends RoleType>(
  role: R,
  workspace: Workspace,
  iteration: IterationContext,
  upstream_outputs: Partial<Record<RoleType, RoleOutput>>,
): Promise<RoleOutput> {
  const role_def = ROLE_DEFINITIONS[role]
  const assignment = workspace.role_assignments[role]
  const secret = workspace.secrets.find(s => s.id === assignment.secret_id)
  if (!secret) throw new PipelineError('role_unconfigured', role)

  const provider = buildProvider(secret)
  const tools = toolsForRole(role)

  // 1. Assemble prompt (static prefix + dynamic suffix)
  const system_prompt = assembleSystemPrompt(role_def, workspace, iteration)

  // 2. Build input envelope (user message)
  const input_envelope = buildInputEnvelope(role, upstream_outputs, iteration)

  // 3. Call model with tool support, retrying on retryable errors
  let attempt = 0
  while (attempt < MAX_ROLE_ATTEMPTS) {
    attempt++
    try {
      const response = await runWithTools({
        provider,
        model: assignment.model_id,
        system_prompt,
        user_message: input_envelope,
        tools,
        max_tokens: role_def.max_output_tokens,
        ctx: { workspace, iteration, role },
      })

      // 4. Parse + validate envelope
      const envelope = parseRoleOutput(response.content, role)
      validatePayload(envelope.payload, role_def.outputSchema)

      // 5. Synthesis-discipline check (Architect-specific)
      if (role === 'architect') {
        const violations = detectSynthesisDiscipline(envelope)
        if (violations.length > 0 && attempt < MAX_ROLE_ATTEMPTS) {
          // Re-prompt with corrective feedback
          continue_with_correction(violations)
          continue
        }
      }

      // 6. Cost tracking
      iteration.cost_tracker.record({
        role, model: assignment.model_id, usage: response.usage,
      })

      return envelope
    } catch (e) {
      if (isRetryable(e) && attempt < MAX_ROLE_ATTEMPTS) {
        await delay(retry_after(e, attempt))
        continue
      }
      throw e
    }
  }
  throw new PipelineError('role_max_attempts_exceeded', role)
}

const MAX_ROLE_ATTEMPTS = 3
```

### 3.1 The `runWithTools` inner loop

Inside a single role invocation, the model may call tools multiple
times before producing the final envelope. The harness loops:

```
1. Send (system_prompt, user_message, tools, prior_messages) to provider
2. Stream response
3. If tool_use:
   a. Validate tool input via Zod
   b. Call tool.call(input, ctx)
   c. Append tool result to messages
   d. Loop back to step 1
4. If text response (no more tool calls):
   a. Validate that the text is a single XML envelope
   b. Return
```

Per-role tool call cap: 20. Beyond that, the harness terminates the
role with a `role_failed` event noting "tool loop exceeded budget."

---

## 4. Parallel execution (roles 5, 6, 7)

After Coder completes:

```typescript
async function runParallelReviewers(
  workspace: Workspace,
  iteration: IterationContext,
  upstream: Partial<Record<RoleType, RoleOutput>>,
): Promise<{
  adversary: RoleOutput
  long_term_critic: RoleOutput
  test_runner: RoleOutput
}> {
  const [adversary, long_term_critic, test_runner] = await Promise.all([
    invokeRole('adversary', workspace, iteration, upstream),
    invokeRole('long_term_critic', workspace, iteration, upstream),
    invokeRole('test_runner', workspace, iteration, upstream),
  ])
  return { adversary, long_term_critic, test_runner }
}
```

If any of the three throws, the orchestrator awaits the others (no
fail-fast — partial reviewer output is still useful), then surfaces
the failure in the Communicator's input.

---

## 5. Conflict detection

After parallel reviewers complete, the orchestrator runs a pure
function to detect cross-role disagreements:

```typescript
type RoleConflict = {
  id: string                            // 'CONFLICT-{iteration}-{n}'
  type:
    | 'adversary_flagged_test_passed'   // Adversary says buggy, Tests pass
    | 'critic_warns_coder_proceeds'     // Long-term sees fragility, Coder happy
    | 'architect_overridden_silently'   // Coder.architect_disagreement non-empty
    | 'reviewers_disagree_on_severity'  // Adv critical vs Crit low
    | 'test_failed_coder_ok'            // Coder.status=ok but Tests failed
  involved_roles: RoleType[]
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string                    // human-readable, fed to Communicator
  user_action_required: boolean          // true → Communicator builds disagreement_card
}

function detectConflicts(outputs: AllRoleOutputs): RoleConflict[] {
  const conflicts: RoleConflict[] = []

  // Rule 1: Adversary flagged but tests passed
  const adv_high_or_critical = outputs.adversary.payload.issues
    .filter(i => i.severity === 'high' || i.severity === 'critical')
  if (adv_high_or_critical.length > 0 &&
      outputs.test_runner.status === 'passed') {
    conflicts.push({
      id: ..., type: 'adversary_flagged_test_passed', ...
      severity: 'high',
      user_action_required: true,
    })
  }

  // Rule 2: Coder claimed ok but tests failed
  if (outputs.coder.status === 'ok' &&
      outputs.test_runner.status === 'failed') {
    conflicts.push({
      id: ..., type: 'test_failed_coder_ok', ...
      severity: 'critical',
      user_action_required: true,
    })
  }

  // Rule 3: Coder's architect_disagreement is non-empty
  if (outputs.coder.payload.architect_disagreement) {
    conflicts.push({
      id: ..., type: 'architect_overridden_silently', ...
      severity: 'medium',
      user_action_required: true,
    })
  }

  // Rule 4: Reviewers strongly disagree
  // (Adversary flagged 'critical' AND Long-term Critic 'healthy')
  if (outputs.adversary.payload.issues.some(i => i.severity === 'critical') &&
      outputs.long_term_critic.status === 'healthy') {
    conflicts.push({
      id: ..., type: 'reviewers_disagree_on_severity', ...
      severity: 'medium',
      user_action_required: true,
    })
  }

  // Rule 5: Long-term Critic warns but Coder shipped
  if (outputs.long_term_critic.status === 'warning' ||
      outputs.long_term_critic.status === 'critical') {
    conflicts.push({
      id: ..., type: 'critic_warns_coder_proceeds', ...
      severity: outputs.long_term_critic.status === 'critical' ? 'high' : 'medium',
      user_action_required: outputs.long_term_critic.status === 'critical',
    })
  }

  return conflicts
}
```

The conflicts list is appended to the Communicator's input. The
Communicator's prompt (per `docs/prompts/08-communicator.md` §9)
spells out which conflicts warrant a `disagreement_card` in the
user-facing output.

---

## 6. Re-prompt logic

When a role's output fails validation, the orchestrator can re-prompt
with corrective feedback. Cases:

### 6.1 Envelope parse failure

Model produced output that's not a valid `<role-output>` envelope.

**Action**: append a system reminder to the conversation:
```
The output you produced does not match the required envelope format.
Re-emit your response as a single <role-output> XML envelope with no
content before or after. Refer to your role's output schema. The
parser failed at: {error_location}.
```

Retry with same input. Up to 2 re-prompts.

### 6.2 Payload schema validation failure

Envelope parsed, but the JSON payload doesn't match the role's
`outputSchema`.

**Action**: append:
```
Your <payload> JSON does not match the required schema. Validation
errors:
- {field_path_1}: {error_1}
- {field_path_2}: {error_2}

Re-emit the entire <role-output> envelope with a corrected payload.
```

Retry. Up to 2 re-prompts.

### 6.3 Synthesis discipline violation (Architect only)

Output contained forbidden phrases ("based on the prior...", "per the
analysis above...", etc.).

**Action**: append:
```
Your output contained the phrase: "{matched_phrase}".

This is a synthesis discipline violation. Restate the specific facts
from the upstream role's output instead of referencing the upstream
output abstractly. The Coder must be able to act on your guidance
without reading any other role's output.

Re-emit your envelope with concrete facts substituted in.
```

Retry. Up to 2 re-prompts. After 2, the orchestrator emits the
output anyway with a `synthesis_discipline_warning` flag — this is
a real bug to investigate but shouldn't block iteration progress.

### 6.4 Tool-call loop budget exceeded

Role made >20 tool calls without producing a final envelope.

**Action**: terminate the role; emit `role_failed` event. No retry.
Surface to Communicator as: "Role X exceeded its tool-call budget;
output not produced."

### 6.5 Provider error (transient)

Network timeout, 429 rate limit, 5xx.

**Action**: see provider's `retryable` flag. If retryable, exponential
backoff (200ms × 2^attempt, capped at 5s). Up to 3 attempts.

### 6.6 Provider error (terminal)

`auth_failed`, `quota_exceeded`, `context_too_long`.

**Action**: no retry. Terminate iteration, surface to user with the
specific error.

---

## 7. Synthesis discipline detection (ADR-012)

The Architect's output is run through a regex check before being
accepted:

```typescript
const FORBIDDEN_PHRASES = [
  /based on (the |)(prior|previous|earlier) (analysis|findings|output|role)/i,
  /per the (Translator|Designer|spec|design|analysis)/i,
  /as (discussed|noted|mentioned) (above|earlier|previously)/i,
  /following the (patterns|guidance) (identified|established) (earlier|above)/i,
]

function detectSynthesisDiscipline(envelope: RoleOutput): string[] {
  const text = JSON.stringify(envelope.payload)
  return FORBIDDEN_PHRASES
    .map(p => text.match(p))
    .filter(m => m !== null)
    .map(m => m![0])
}
```

This applies **only** to the Architect role. Other roles are allowed
to reference upstream output by name (because they may need to flag
disagreements with specific upstream content).

---

## 8. Cost tracking

```typescript
class CostTracker {
  private records: Array<{
    role: RoleType
    model: string
    provider: ProviderId
    input_tokens: number
    output_tokens: number
    cached_input_tokens: number
    estimated_cost_usd: number
    timestamp: number
  }> = []

  record(entry: { role, model, usage }): void { ... }
  perRoleTotals(): Record<RoleType, number> { ... }
  perModelTotals(): Record<string, number> { ... }
  iterationTotal(): number { ... }
  workspaceTotalSinceCreation(): number { ... }
}
```

Cost data is persisted to SQLite per-iteration. Workspace UI shows:
- Per-iteration total (with breakdown by role on hover)
- Workspace lifetime total
- Free-tier quotas if applicable (e.g. GLM free tier: show usage
  against limit)

---

## 9. Pipeline result contract

```typescript
type PipelineResult =
  | {
      status: 'completed'
      iteration_id: string
      duration_ms: number
      total_cost_usd: number
      role_outputs: AllRoleOutputs
      conflicts: RoleConflict[]
      communicator_output: CommunicatorOutput  // user-facing payload
      memory_updates_applied: MemoryDelta
      files_changed: string[]                  // paths
    }
  | {
      status: 'aborted'
      iteration_id: string
      stopped_at_role: RoleType
      reason: string
      partial_outputs: Partial<AllRoleOutputs>
      cost_so_far_usd: number
    }
  | {
      status: 'failed'
      iteration_id: string
      stopped_at_role: RoleType
      error: PipelineError
      partial_outputs: Partial<AllRoleOutputs>
      cost_so_far_usd: number
    }
```

The UI subscribes to events during the run and gets the final
`PipelineResult` at the end.

---

## 10. Abort handling

User can abort mid-run via UI button. Mechanism:

1. UI calls `pipeline.abort(reason)`.
2. Orchestrator calls `abort_signal.abort()` on the current role's
   context.
3. Provider adapter receives the abort, terminates the streaming
   request.
4. Tool calls in flight: they receive the abort signal too; bash
   sends SIGTERM, file ops short-circuit on next yield point.
5. Orchestrator emits `iteration_aborted` event.
6. Returns `PipelineResult { status: 'aborted', ... }` with
   `partial_outputs` populated for any roles that completed before
   abort.

Aborted iterations are still recorded in history (for cost tracking
and so the user can see what they spent).

---

## 11. Project memory updates

The Architect role emits memory updates as part of its envelope.
The orchestrator applies them to SQLite **after the entire pipeline
completes successfully**, not mid-pipeline.

```typescript
async function applyMemoryUpdates(
  workspace: Workspace,
  iteration: IterationContext,
  outputs: AllRoleOutputs,
): Promise<MemoryDelta> {
  const archUpdates = outputs.architect.payload.memory_updates
  const ltcLessons = outputs.long_term_critic.payload.memory_lessons_to_persist
  const adversaryDebt = outputs.adversary.payload.issues
    .filter(i => i.severity === 'high' || i.severity === 'critical')
    .map(toTechDebtEntry)

  // Apply via update_project_memory tool's underlying logic
  // (orchestrator can invoke the tool directly with a synthetic
  // ToolContext, since orchestrator has full workspace access)
  ...

  return delta
}
```

Memory updates are NOT applied for `aborted` or `failed` iterations
(prevents memory pollution from incomplete runs).

---

## 12. Telemetry / logging

Every pipeline run emits a structured trace:

```typescript
type IterationTrace = {
  iteration_id: string
  workspace_id: string
  started_at: string
  ended_at: string
  result: 'completed' | 'aborted' | 'failed'
  per_role: Record<RoleType, {
    started_at: string
    ended_at: string
    model: string
    provider: ProviderId
    attempts: number                        // re-prompts
    tool_calls: number
    input_tokens: number
    output_tokens: number
    estimated_cost_usd: number
    final_status: string
  }>
  conflicts_detected: number
  total_cost_usd: number
  total_duration_ms: number
}
```

Stored in workspace's SQLite; surfaced in UI's "Iteration History"
view (V1+).

V0 telemetry is local-only. No remote analytics.

---

## 13. Pseudocode: `runIteration()`

```typescript
async function runIteration(
  workspace: Workspace,
  user_prompt: string,
): Promise<PipelineResult> {
  const iteration = createIterationContext(workspace, user_prompt)
  const trace = startTrace(iteration)
  const outputs: Partial<AllRoleOutputs> = {}

  try {
    // Sequential: 1, 2, 3, 4
    outputs.translator = await invokeRole('translator', workspace, iteration, outputs)
    if (outputs.translator.status === 'needs_clarification') {
      const userResponse = await pauseForUser(outputs.translator)
      // (Re-invoke translator with the user's response — simplified here)
      outputs.translator = await invokeRole('translator', workspace, iteration, outputs)
    }

    outputs.designer = await invokeRole('designer', workspace, iteration, outputs)

    outputs.architect = await invokeRole('architect', workspace, iteration, outputs)
    if (outputs.architect.status === 'conflict_detected') {
      const userDecision = await pauseForUser(outputs.architect)
      // Branch: proceed | override memory | abort iteration
      if (userDecision === 'abort') return abortedResult(iteration, outputs)
    }

    outputs.coder = await invokeRole('coder', workspace, iteration, outputs)

    // Parallel: 5, 6, 7
    const reviewers = await runParallelReviewers(workspace, iteration, outputs)
    outputs.adversary = reviewers.adversary
    outputs.long_term_critic = reviewers.long_term_critic
    outputs.test_runner = reviewers.test_runner

    // Conflict detection (pure)
    const conflicts = detectConflicts(outputs as AllRoleOutputs)

    // Sequential: 8
    outputs.communicator = await invokeRole(
      'communicator', workspace, iteration,
      { ...outputs, conflicts } as any,
    )

    // Apply memory updates after success
    const memoryDelta = await applyMemoryUpdates(workspace, iteration, outputs as AllRoleOutputs)

    return completedResult(iteration, outputs as AllRoleOutputs, conflicts, memoryDelta)
  } catch (e) {
    return failedResult(iteration, outputs, e)
  } finally {
    finishTrace(trace, outputs)
  }
}
```

---

## 14. Configuration / tunables

```typescript
const ORCHESTRATOR_CONFIG = {
  MAX_ROLE_ATTEMPTS: 3,
  MAX_TOOL_CALLS_PER_ROLE: 20,
  ROLE_TIMEOUT_MS: 120_000,                  // hard cap per role
  PIPELINE_TIMEOUT_MS: 600_000,              // hard cap per iteration
  RETRY_BASE_DELAY_MS: 200,
  RETRY_MAX_DELAY_MS: 5_000,
  PARALLEL_REVIEWERS: ['adversary', 'long_term_critic', 'test_runner'],
}
```

These are constants in V0. V0.4+ exposes them in workspace settings.

---

## 15. Open questions

1. **What happens when AWAITING_USER is interrupted by abort?**
   V0: treat as `iteration_aborted`. The pending user question is
   discarded.

2. **Iteration retry on failure**: should the user be offered a
   "retry this iteration" button? V0: yes, but with a fresh
   iteration_id (the failed one is recorded in history). Memory
   updates from the failed run are not applied, so retry sees
   pre-failure memory state.

3. **Multiple users editing one workspace**: out of V0 scope
   (Desktop-first, no multi-user — see ADR-005).

4. **What if Translator produces a spec that's clearly outside
   capabilities (e.g. "build me a self-driving car")?** V0:
   Translator emits `needs_clarification` with the question
   "this seems out of scope; what specifically can polycoder help
   you scope to?". User-controlled escalation.

5. **Iteration budget per workspace?** Optional cost cap (e.g.
   "stop iterating after $5 spent"). V0: not enforced — UI shows
   running cost and lets the user decide. V1+ may add hard caps.

6. **Streaming UI updates during a role run**: the UI wants to show
   each role's output as it streams in. The orchestrator emits
   `role_progress` events during streaming. UI implementation TBD
   — likely a server-sent events bridge over Electron IPC.

---

## 16. Implementation order

When implementation starts (see `todo.md`):

1. **Type definitions** (`core/types/`)
2. **Pipeline event bus** (subscribers, emitters)
3. **`assembleSystemPrompt`** (ties to `docs/prompts/`)
4. **`buildInputEnvelope`** (XML envelope construction)
5. **`parseRoleOutput`** + **`validatePayload`**
6. **`runWithTools`** (the inner loop with provider + tools)
7. **`invokeRole`** (single-role orchestration with retry)
8. **`runParallelReviewers`**
9. **`detectConflicts`** (pure function — easy to test in isolation)
10. **`detectSynthesisDiscipline`** (regex-based)
11. **`runIteration`** (top-level)
12. **CostTracker class**
13. **PipelineError taxonomy**
14. **applyMemoryUpdates**
15. **IterationTrace persistence**
16. **Tests** (parallel with each layer; conflict-detection and
    synthesis-discipline detection are particularly worth unit
    testing)

Estimated total: ~2000 LOC across ~20 source files + ~1500 LOC of
tests.

This is the single biggest piece of polycoder by line count, and
the highest-leverage to get right. Heavy unit testing recommended.
