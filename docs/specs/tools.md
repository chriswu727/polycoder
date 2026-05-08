# Tools Framework + V0 Tools — Implementation Spec

> **Status**: Design contract. Implementation has not started.
> **Related**: ADR-008 (tool framework with metadata flags),
> [`docs/claude-code-learnings.md` §2 and §7](../claude-code-learnings.md#2)
> (Tool.ts patterns we adopted)

---

## 1. The ToolDef interface

Modeled on Claude Code's `Tool.ts`, simplified to V0 scope.

```typescript
// tools/ToolDef.ts

import type { ZodType } from 'zod'

export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'bash'
  | 'read_project_memory'
  | 'update_project_memory'
  | 'read_history'
  | 'ask_user_question'
  | 'read_design_tokens'
  | 'run_test_suite'

export type ToolContext = {
  workspace_id: string
  workspace_root: string                    // absolute path
  iteration_id: string
  role: RoleType                            // which role is calling
  abort_signal: AbortSignal
  emit_event: (event: ToolEvent) => void    // streaming progress
  cost_tracker: CostTracker
}

export type ToolEvent =
  | { type: 'progress', message: string }
  | { type: 'partial_output', text: string }
  | { type: 'side_effect', description: string }    // e.g. "wrote 42 bytes"

export type ToolDef<I, O> = {
  name: ToolName
  description: string                       // shown to the model in the tool schema
  inputSchema: ZodType<I>
  outputSchema: ZodType<O>

  /**
   * The actual implementation. May throw ToolError; orchestrator
   * catches and routes errors back to the role with structured info.
   */
  call: (input: I, ctx: ToolContext) => Promise<O>

  /**
   * Pure read? Drives default permission policy and parallelism rules.
   */
  isReadOnly: (input: I) => boolean

  /**
   * Safe to run multiple instances of this tool simultaneously?
   * If false, orchestrator queues tool calls within a single role.
   */
  isConcurrencySafe: (input: I) => boolean

  /**
   * Restricted to specific roles? If set, orchestrator rejects
   * out-of-scope calls before reaching call(). Empty/undefined means
   * any role's allowlist may include this tool.
   */
  allowedRoles?: RoleType[]
}

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    readonly tool_name: ToolName,
    readonly user_message: string,
    readonly recoverable: boolean,
    readonly raw_error?: unknown
  ) { super(user_message) }
}

export type ToolErrorCode =
  | 'invalid_input'
  | 'permission_denied'        // role tried to call a tool not in its allowlist
  | 'file_not_found'
  | 'file_too_large'
  | 'workspace_violation'      // path escaped workspace_root
  | 'sandbox_violation'        // bash command outside allowed pattern
  | 'timeout'
  | 'external_failure'         // bash exit code != 0 in unexpected way
  | 'unknown'
```

---

## 2. The buildTool factory

Per Claude Code's pattern, all tools go through a factory that fills
in safe defaults:

```typescript
// tools/buildTool.ts

const DEFAULTS = {
  isReadOnly: () => false,            // assume writes
  isConcurrencySafe: () => false,     // assume not concurrent-safe
  allowedRoles: undefined,            // any role may include
}

export function buildTool<I, O>(def: Partial<ToolDef<I, O>> & {
  name: ToolName
  description: string
  inputSchema: ZodType<I>
  outputSchema: ZodType<O>
  call: ToolDef<I, O>['call']
}): ToolDef<I, O> {
  return {
    ...DEFAULTS,
    ...def,
  } as ToolDef<I, O>
}
```

**Rule**: Every exported tool goes through `buildTool`. No raw
ToolDef literals.

---

## 3. Permission model (V0)

V0 simplifies Claude Code's elaborate permission system to:

- **Static allowlist per role.** Each role's `RoleDefinition` lists
  allowed tools. The orchestrator filters the tool schema sent to a
  role's model accordingly. A role calling a tool not in its
  allowlist is a structural error (returns `permission_denied`,
  flagged as a bug — should never happen if allowlist is set up
  correctly).

- **No mid-run user prompts.** V0 runs the pipeline through to
  completion before user reviews. There are no interactive
  permission dialogs during a pipeline run. (V1+ may add
  bash-command confirmation for risky operations.)

- **Workspace boundary check.** All file-path tools (`read_file`,
  `write_file`, `edit_file`) validate that the requested path
  resolves to within `ctx.workspace_root`. Paths escaping the
  workspace are rejected with `workspace_violation` regardless of
  role.

- **Bash sandboxing (Test Runner only).** The `bash` tool's input
  is regex-validated against an allowed pattern before execution.
  See §4.4.

---

## 4. The 10 V0 tools

### 4.1 `read_file`

Read the contents of a file in the workspace.

```typescript
const ReadFileInput = z.object({
  path: z.string().min(1),
  start_line: z.number().int().nonnegative().optional(),
  end_line: z.number().int().positive().optional(),
})

const ReadFileOutput = z.object({
  content: z.string(),
  total_lines: z.number().int(),
  path: z.string(),
  truncated: z.boolean(),
})
```

- **Allowed roles**: `architect`, `coder`, `adversary`, `long_term_critic`, `test_runner`, `designer`
- **isReadOnly**: true
- **isConcurrencySafe**: true
- **Constraints**:
  - Path resolved to absolute, must be within `workspace_root`
  - Default reads first 2000 lines; truncate beyond
  - Returns line numbers prefixed for the role's reference (per
    Claude Code convention: `1\thello world\n`)
- **Errors**: `file_not_found`, `workspace_violation`, `file_too_large`
  (>10MB)
- **Implementation file**: `tools/readFile.ts`

### 4.2 `write_file`

Create a new file. Refuses to overwrite — use `edit_file` for that.

```typescript
const WriteFileInput = z.object({
  path: z.string().min(1),
  content: z.string(),
})

const WriteFileOutput = z.object({
  path: z.string(),
  bytes_written: z.number().int(),
})
```

- **Allowed roles**: `coder` (production code), `test_runner` (test files only — see §4.4 for the test-file pattern check)
- **isReadOnly**: false
- **isConcurrencySafe**: false (filesystem writes)
- **Constraints**:
  - Path within workspace
  - Refuses if file already exists (clear error message)
  - Auto-creates parent directories
  - For Test Runner: path must match `**/*.{test,spec}.{ts,tsx,js,jsx}` or `**/test/**` or `**/__tests__/**`
- **Errors**: `workspace_violation`, `file_too_large` (>1MB write),
  `external_failure` (parent dir creation issue)
- **Implementation file**: `tools/writeFile.ts`

### 4.3 `edit_file`

Apply an exact-string replacement to an existing file. Modeled on
Claude Code's `FileEditTool`.

```typescript
const EditFileInput = z.object({
  path: z.string().min(1),
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().default(false),
})

const EditFileOutput = z.object({
  path: z.string(),
  replacements_made: z.number().int(),
  diff_unified: z.string(),                 // unified diff for UI display
})
```

- **Allowed roles**: `coder`
- **isReadOnly**: false
- **isConcurrencySafe**: false
- **Constraints**:
  - File must exist; must have been read at least once in the
    current iteration (mirroring Claude Code's "Read before Edit"
    rule). Tracking via `ctx.read_files_in_iteration`.
  - `old_string` must be unique unless `replace_all: true`
  - Atomic: writes to temp file then renames, on failure leaves
    original untouched
- **Errors**: `file_not_found`, `invalid_input` (non-unique
  old_string without replace_all), `workspace_violation`
- **Implementation file**: `tools/editFile.ts`

### 4.4 `bash` (sandboxed for Test Runner)

Run a bash command. **V0 restriction: only Test Runner can call this,
and only for test commands.**

```typescript
const BashInput = z.object({
  command: z.string().min(1),
  timeout_ms: z.number().int().positive().max(300_000).default(60_000),
  cwd_relative: z.string().default('.'),
})

const BashOutput = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exit_code: z.number().int(),
  duration_ms: z.number().int(),
  truncated_stdout: z.boolean(),
  truncated_stderr: z.boolean(),
})
```

- **Allowed roles**: `test_runner`
- **isReadOnly**: false (assume side effects)
- **isConcurrencySafe**: false
- **Constraints (V0 sandbox pattern)**:
  - The `command` regex must match one of:
    - `^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t)(\s|$)`  (test runners)
    - `^(npx|pnpx|bunx)\s+(vitest|jest|mocha|playwright)\b`
    - `^(vitest|jest)\b`
    - `^pytest\b`
    - `^go\s+test\b`
  - `cwd_relative` resolved against workspace_root, must stay within
  - `stdout`/`stderr` truncated to 50KB each (with `truncated: true`)
  - timeout enforced via SIGTERM then SIGKILL
- **Errors**: `sandbox_violation` (regex mismatch), `timeout`,
  `external_failure` (spawn error)
- **Implementation file**: `tools/bash.ts`
- **V1+ extension**: open up to other roles with a more elaborate
  sandbox model (allow `tsc --noEmit` for Architect, etc.)

### 4.5 `read_project_memory`

Read the current project memory snapshot.

```typescript
const ReadMemoryInput = z.object({
  section: z.enum([
    'all',
    'conventions',
    'decisions',
    'components_registry',
    'pending_tech_debt',
  ]).default('all'),
})

const ReadMemoryOutput = z.object({
  // shape depends on section; default 'all' returns the full ProjectMemory type
  ...
})
```

- **Allowed roles**: all 8 roles
- **isReadOnly**: true
- **isConcurrencySafe**: true
- **Constraints**:
  - Memory is read from the workspace's SQLite store
  - Returned object is a deep copy (no shared references)
- **Errors**: none expected (workspace_id is implicit; if missing,
  it's a programming bug)
- **Implementation file**: `tools/readProjectMemory.ts`

### 4.6 `update_project_memory`

Apply structured updates to the project memory. **Architect-only.**

```typescript
const UpdateMemoryInput = z.object({
  add_decisions: z.array(DecisionSchema).optional(),
  add_conventions: z.array(ConventionSchema).optional(),
  add_components: z.array(ComponentRegistryEntrySchema).optional(),
  add_tech_debt: z.array(TechDebtSchema).optional(),
  supersede_decision: z.array(z.object({
    old_decision_id: z.string(),
    new_decision_id: z.string(),
  })).optional(),
})

const UpdateMemoryOutput = z.object({
  decisions_added: z.number().int(),
  conventions_added: z.number().int(),
  components_added: z.number().int(),
  tech_debt_added: z.number().int(),
  superseded: z.number().int(),
})
```

- **Allowed roles**: `architect` only
- **isReadOnly**: false
- **isConcurrencySafe**: false (writes to single SQLite row)
- **Constraints**:
  - Decisions are append-only; "delete" is via supersede
  - Each decision/convention/component must have an `id` (UUID); if
    omitted, generated server-side
  - All entries are timestamped automatically
- **Errors**: `invalid_input` (e.g. supersede references unknown ID)
- **Implementation file**: `tools/updateProjectMemory.ts`

### 4.7 `read_history`

Read summarized history of past iterations in this workspace.

```typescript
const ReadHistoryInput = z.object({
  last_n: z.number().int().positive().max(50).default(10),
  include_full_envelopes: z.boolean().default(false),
})

const ReadHistoryOutput = z.object({
  iterations: z.array(z.object({
    iteration_number: z.number().int(),
    timestamp: z.string(),                  // ISO 8601
    user_prompt: z.string(),                // truncated to 500 chars
    intent_summary: z.string(),             // from Translator
    traffic_light: z.enum(['green', 'yellow', 'red']),
    coder_status: z.string(),
    test_runner_status: z.string(),
    files_changed: z.array(z.string()),     // paths only
    full_envelopes: z.record(z.unknown()).optional(),  // if requested
  })),
})
```

- **Allowed roles**: `long_term_critic`, `architect`
- **isReadOnly**: true
- **isConcurrencySafe**: true
- **Constraints**:
  - `include_full_envelopes` is expensive (returns the entire
    iteration's role outputs); only Long-term Critic should use this
- **Errors**: none expected
- **Implementation file**: `tools/readHistory.ts`

### 4.8 `ask_user_question`

Pause the pipeline to ask the user a clarifying question. **Translator-only.**

```typescript
const AskUserQuestionInput = z.object({
  question: z.string().min(1).max(500),
  options: z.array(z.object({
    label: z.string().min(1).max(100),
    description: z.string().optional(),
  })).min(2).max(6),
  allow_other: z.boolean().default(true),
  recommended_index: z.number().int().nonnegative().optional(),
})

const AskUserQuestionOutput = z.object({
  selected_index: z.number().int().nonnegative(),  // -1 if "Other"
  custom_text: z.string().optional(),               // if "Other" selected
})
```

- **Allowed roles**: `translator` only
- **isReadOnly**: false (mutates user state — interaction)
- **isConcurrencySafe**: false (only one question at a time)
- **Constraints**:
  - Pipeline pauses until user responds (or aborts)
  - V0 implementation: emits a UI event the workspace UI subscribes
    to; the UI shows the question with multiple-choice buttons
  - Recommended option is shown first with "(Recommended)" label
- **Errors**: none expected (timeout handled at UI layer; resolves
  to abort if user closes dialog)
- **Implementation file**: `tools/askUserQuestion.ts`

### 4.9 `read_design_tokens`

Read the current design tokens for the workspace (color palette,
typography scale, spacing units). Designer-only.

```typescript
const ReadDesignTokensInput = z.object({
  // no input args; returns current tokens
})

const ReadDesignTokensOutput = z.object({
  colors: z.record(z.string()),
  typography: z.object({
    font_family: z.string(),
    scale: z.array(z.string()),
  }),
  spacing: z.object({
    unit: z.string(),
    scale: z.array(z.number()),
  }),
  established_in_iteration: z.number().int().nullable(),
})
```

- **Allowed roles**: `designer` only
- **isReadOnly**: true
- **isConcurrencySafe**: true
- **Constraints**:
  - Tokens are stored as part of project memory (ADR-009 pattern:
    long-lived state)
  - On iteration 1 (no tokens yet), returns null fields
- **Errors**: none expected
- **Implementation file**: `tools/readDesignTokens.ts`

### 4.10 `run_test_suite`

A higher-level convenience wrapper around `bash` for Test Runner.
Detects the project's test framework and runs the appropriate
command.

```typescript
const RunTestSuiteInput = z.object({
  scope: z.enum(['all', 'changed_files', 'specific']).default('all'),
  specific_files: z.array(z.string()).optional(),
  framework_override: z.enum(['vitest', 'jest', 'pytest', 'go-test', 'bun-test']).optional(),
})

const RunTestSuiteOutput = z.object({
  command_used: z.string(),
  framework_detected: z.string(),
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  passed_count: z.number().int().nullable(),       // null if not parseable
  failed_count: z.number().int().nullable(),
  skipped_count: z.number().int().nullable(),
  duration_ms: z.number().int(),
})
```

- **Allowed roles**: `test_runner` only
- **isReadOnly**: false
- **isConcurrencySafe**: false
- **Constraints**:
  - Detects framework from `package.json` `test` script, then from
    presence of `vitest.config.*` / `jest.config.*` / etc.
  - Falls back to bash if no framework detected (Test Runner emits
    `cannot_run` status in that case)
  - Parses test runner output to fill `passed/failed/skipped` if
    possible (best-effort regex; `null` if parse fails)
- **Errors**: `external_failure`, `timeout`
- **Implementation file**: `tools/runTestSuite.ts`

---

## 5. Tool registration

```typescript
// tools/registry.ts

export const ALL_TOOLS: Record<ToolName, ToolDef<any, any>> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  bash: bashTool,
  read_project_memory: readProjectMemoryTool,
  update_project_memory: updateProjectMemoryTool,
  read_history: readHistoryTool,
  ask_user_question: askUserQuestionTool,
  read_design_tokens: readDesignTokensTool,
  run_test_suite: runTestSuiteTool,
}

/**
 * Compute the toolset for a given role, honoring the role's allowlist
 * and each tool's allowedRoles restriction.
 */
export function toolsForRole(role: RoleType): ToolDef<any, any>[] {
  const roleDef = getRoleDefinition(role)
  return roleDef.allowedTools
    .map(name => ALL_TOOLS[name])
    .filter(t => !t.allowedRoles || t.allowedRoles.includes(role))
}
```

The orchestrator calls `toolsForRole(role)` to derive the tool
schema sent to the model for each role call.

---

## 6. Tool schema → model format

The `inputSchema` Zod schemas are converted to JSON Schema for
sending to the LLM. Implementation:

```typescript
// tools/toJsonSchema.ts
import { zodToJsonSchema } from 'zod-to-json-schema'

export function toolToProviderSchema(
  tool: ToolDef<any, any>,
  providerStyle: 'openai' | 'anthropic',
): unknown {
  const inputJsonSchema = zodToJsonSchema(tool.inputSchema)

  if (providerStyle === 'anthropic') {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: inputJsonSchema,
    }
  } else {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: inputJsonSchema,
      },
    }
  }
}
```

The provider adapter handles the final wrapping into its
provider-native shape.

---

## 7. Tool execution flow

When a role's model returns a tool call:

1. Provider adapter parses tool call, yields `tool_call_end` stream
   event with parsed arguments.
2. Role harness intercepts: validates `arguments` against the tool's
   `inputSchema` (Zod parse). On failure: returns `invalid_input`
   ToolError to the model as a tool result, model retries.
3. Role harness checks: is this tool in the calling role's allowlist?
   If not → `permission_denied`. (Should never happen — allowlist
   filtered before sending tools to model.)
4. Role harness invokes `tool.call(input, ctx)`. Awaits result or
   error.
5. On success: result is validated against `outputSchema` (sanity
   check; should always pass). Result returned to the model as a
   tool result (the model continues its turn).
6. On `ToolError`: error returned to the model as a tool result with
   structured error info; model decides whether to retry, give up,
   or work around.
7. After model's terminal response (no more tool calls), the role
   harness assembles the final `<role-output>` envelope.

---

## 8. Tool prompts (model-facing description text)

The `description` field of each tool is what the model sees. We
follow Claude Code's pattern:

- Imperative mood
- "Use X (NOT Y)" preference rules where applicable
- "When NOT to use" sections for tools where misuse is a real risk
- Concrete examples

For each of the 10 tools, the description string is drafted in
its implementation file. The descriptions follow the patterns
established in Claude Code's `tools/*/prompt.ts` files (which we
inspected; see `claude-code-learnings.md` §4).

V0 ships descriptions inline in the tool implementation. V1+ may
externalize to `docs/tool-descriptions/*.md` for editability without
code changes.

---

## 9. Open questions

1. **Should `read_file` support binary files (images for Designer)?**
   V0: text only. Designer's image-input feature uses a separate
   mechanism (multimodal message blocks, not tool-fetched). Defer.

2. **Should `bash` support stdin?** V0: no. If a tool needs to feed
   input, it can use shell pipelines (`echo "x" | cmd`). Avoids
   the IPC complexity for V0.

3. **Concurrency limits per role?** When Adversary, Long-term Critic,
   Test Runner run in parallel and all use `read_file`, do we cap
   simultaneous file reads? V0: no cap (filesystem is fast). Add if
   benchmark shows contention.

4. **Tool result caching?** If two roles `read_file` the same file
   in the same iteration, do we deduplicate? V0: no (simple, and
   reads are cheap). V1+: cache per-iteration.

5. **Network access for tools (web search, fetch)?** Out of V0 scope.
   Long-term Critic might benefit from web search ("is this library
   still maintained?"). V1+ feature.

---

## 10. Implementation order

When implementation starts (see `todo.md`):

1. **ToolDef interface + buildTool factory** (foundational)
2. **Workspace boundary helpers** (path resolution, validation)
3. **read_file** (simplest; many later tools depend on the pattern)
4. **write_file** + **edit_file** (Coder's tools)
5. **read_project_memory** + **update_project_memory** (Architect's tools)
6. **read_history** (Long-term Critic's tool)
7. **bash** + **run_test_suite** (Test Runner's tools, with sandbox)
8. **ask_user_question** (interactive; depends on UI scaffolding)
9. **read_design_tokens** (Designer; depends on memory)
10. **registry.ts**
11. **toJsonSchema helper**
12. **Tests** (parallel with each tool)

Estimated total: ~1500 LOC across 13 source files + ~1500 LOC of
tests.
