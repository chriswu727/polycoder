# Lessons from Claude Code's Source Code

Notes from reading the Claude Code source (v Apr 2026). Each section
captures one observation, what we adopt for polycoder, and what we deliberately
diverge from.

---

## 1. The Coordinator/Worker pattern is the production-grade analog of MetaGPT

**Source**: `src/coordinator/coordinatorMode.ts` (full text inspected)

Claude Code has a real, shipped, multi-agent mode where one model (the
**coordinator**) does no work itself — it only spawns workers, synthesizes
their results, and decides what to do next. Workers are spawned via the
`AgentTool` and their results arrive as user-role messages wrapped in a
`<task-notification>` XML envelope.

Three key structural decisions in their design:

1. **Workers are autonomous** — they execute their assigned task fully and
   report back when done. Coordinator never reads worker transcripts
   mid-flight ("don't peek").

2. **Continue vs. spawn fresh decision matrix** — there's an explicit table
   in their coordinator system prompt for when to continue an existing
   worker vs. spawn a new one. Summary:
   - Research → narrow implementation: spawn fresh (avoid exploration noise)
   - Research → exact files needing edits: continue (worker has files loaded)
   - Correction or extension of recent work: continue
   - Verification of a different worker's code: spawn fresh (independent eyes)
   - Wrong-approach retry: spawn fresh (clean slate, avoid anchoring)

3. **Synthesis discipline**: "Never delegate understanding." The
   coordinator must read findings, understand them, and write specific
   prompts with file paths and line numbers — not "based on your findings,
   fix the bug."

### What polycoder adopts

- The Coordinator/Worker frame fits our 8-role pipeline cleanly. The
  pipeline orchestrator IS a coordinator; each role is a worker with a
  bounded scope.
- The XML envelope pattern (`<task-notification>`) becomes our inter-role
  communication format (see SPEC §4.6 and ADR-010).
- The synthesis discipline becomes a prompt directive for the Architect
  role specifically (it's the role that synthesizes across iterations).

### What we diverge from

- Claude Code's coordinator decides dynamically *whether* to spawn workers.
  In polycoder, the pipeline is fixed (Translator → … → Communicator) per
  iteration. We don't need the Agent tool's flexibility because our roles
  are predetermined.
- Claude Code workers are general-purpose — they receive a freeform prompt.
  Our workers are *role-bound* — each role has a fixed system prompt and
  produces a fixed output schema.

---

## 2. Tool definitions are far richer than typical agent frameworks

**Source**: `src/Tool.ts` (792 lines, fully inspected)

Each `Tool` carries a large set of metadata flags that drive the agent
loop's behavior:

| Flag | Purpose |
|------|---------|
| `isReadOnly(input)` | Drives default permission policy |
| `isDestructive(input)` | Triggers extra confirmation prompts |
| `isConcurrencySafe(input)` | Determines if the loop can run multiple instances in parallel |
| `isOpenWorld(input)` | Affects whether result is reproducible |
| `shouldDefer` | Tool schema lazy-loaded via ToolSearch |
| `alwaysLoad` | Tool schema always in initial prompt |
| `searchHint` | 3-10 word capability phrase for ToolSearch keyword matching |
| `maxResultSizeChars` | When exceeded, result is persisted to disk |
| `interruptBehavior()` | What happens if user interrupts (cancel vs block) |
| `aliases` | Renames-with-backwards-compat |

Plus a parallel set of UI-rendering methods (`renderToolUseMessage`,
`renderToolResultMessage`, `renderToolUseRejectedMessage`,
`renderToolUseErrorMessage`, `renderToolUseProgressMessage`,
`renderGroupedToolUse`, etc.) that are independent from the tool's logic.

There's also a `buildTool()` factory that fills in safe defaults for all
optional fields, ensuring callers always see a complete Tool.

### What polycoder adopts

- The metadata-flag pattern. polycoder's `ModelProvider` (existing) +
  `ToolDef` (new) will use the same shape: explicit flags drive
  orchestrator behavior, not implicit conventions.
- Specifically for V0 we adopt: `isReadOnly`, `isConcurrencySafe`,
  `description`, `inputSchema`, `call`. The rest defer.
- The `buildTool()` factory pattern with safe defaults — every tool goes
  through the factory; nothing constructs a raw `Tool` literal. This makes
  fail-closed defaults (e.g. "assume not concurrency-safe") universal.

### What we diverge from

- We will NOT have a 30-method UI-rendering API on Tool in V0. polycoder is
  Electron + React; UI rendering is in component code, not on the tool
  object itself. Keep tools logic-only.
- No deferred loading (`shouldDefer`) in V0. With only ~10 internal tools,
  ToolSearch overhead is unjustified.

---

## 3. System prompt has an explicit cache boundary

**Source**: `src/constants/prompts.ts` lines 110-115, 560-577

```typescript
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'
```

Everything **before** this marker is static, cacheable across
sessions/orgs. Everything **after** contains user/session-specific content
(memory, env info, MCP instructions). This split is enforced — there's a
warning comment: *"Do not remove or reorder this marker without updating
cache logic."*

The dynamic sections are managed by a registry (`systemPromptSection()`
helper) so a section can be feature-flagged on/off without rebuilding the
whole prompt.

There's also an even stricter discipline: **anything that varies per turn
is moved into attachment messages (separate cache lines), not the system
prompt**. Example:

> *"The dynamic agent list was ~10.2% of fleet cache_creation tokens: MCP
> async connect, /reload-plugins, or permission-mode changes mutate the
> list → description changes → full tool-schema cache bust."*

So they moved the agent list out of the system prompt into an attachment.
This is real production wisdom about cache economics.

### What polycoder adopts

- Each role's system prompt has a **static section + dynamic suffix**
  separated by a boundary marker.
- Static section: role identity, output schema, operating principles,
  examples
- Dynamic section: project memory, current iteration context, prior round
  outputs
- Per-iteration data (current code diff, test results, prior role output)
  goes into **user-role messages**, not the system prompt — this lets us
  cache the system prompt across all roles within an iteration.

### Why this matters for us specifically

We are calling 8 models per iteration. If any two roles share the same
provider+model (e.g. user assigns DeepSeek to both Translator and
Validator), prompt caching can dramatically reduce cost. For this to
work, each role's system prompt must be designed so the **static prefix
is identical across calls within a session**.

---

## 4. Tool prompts have a consistent structure: imperative + anti-patterns + examples

**Source**: `src/tools/BashTool/prompt.ts`, `src/tools/FileEditTool/prompt.ts`,
`src/tools/AgentTool/prompt.ts`, `src/tools/TaskCreateTool/prompt.ts`

Every tool's prompt follows roughly this shape:

```
[Tool's purpose — one sentence]

[Optional: rich description with constraints]

## Usage
- Imperative bullet: "Always quote file paths..."
- Imperative bullet: "DO NOT use newlines to separate commands..."
- Imperative bullet: "Use X (NOT Y) — because [reason]"

## When to use this tool
- Scenario 1
- Scenario 2

## When NOT to use this tool
- Anti-scenario 1
- Anti-scenario 2 — use [other tool] instead

## Examples
<example>
user: "..."
assistant: <thinking>...</thinking>
[ToolName]({...})
</example>

<example>
[bad case]
[explanation of why it's bad]
</example>
```

Notable patterns:

- **"Use X (NOT Y)" preference rules** — they steer the model away from
  inferior alternatives. E.g., FileEdit explicitly says "ALWAYS prefer
  editing existing files. NEVER write new files unless explicitly required."
- **Reasoning attached to non-obvious rules** — "Don't retry failing
  commands in a sleep loop — diagnose the root cause." The "why" is
  baked in.
- **Quantitative anchors over qualitative** — "≤25 words between tool
  calls" not "be concise" (their internal eval showed 1.2% output token
  reduction from this change).
- **Anti-pattern examples are explicit** — bad cases are shown alongside
  good ones, with commentary explaining why.
- **Imperative mood throughout** — "Always", "Never", "Don't", "Use".

### What polycoder adopts

The exact same structure for each role's system prompt:

1. Identity sentence
2. Purpose (one line)
3. Input/output schema
4. Imperative operating principles (numbered list)
5. Anti-patterns (negative bullet list with reasoning)
6. Examples (good + bad with commentary)
7. Disagreement protocol (role-specific)

---

## 5. The "Don't peek, don't race" discipline for sub-agents

**Source**: `src/tools/AgentTool/prompt.ts` lines 91-93

Two principles, stated tersely:

> *"Don't peek. The tool result includes an output_file path — do not Read
> or tail it unless the user explicitly asks for a progress check. You get
> a completion notification; trust it. Reading the transcript mid-flight
> pulls the fork's tool noise into your context, which defeats the point
> of forking."*

> *"Don't race. After launching, you know nothing about what the fork
> found. Never fabricate or predict fork results in any format — not as
> prose, summary, or structured output. The notification arrives as a
> user-role message in a later turn; it is never something you write
> yourself."*

These two rules together enforce **isolation between agent and orchestrator
context**. Without them, the orchestrator's context gets polluted by
subagent noise (peeking) or hallucinated work (racing).

### What polycoder adopts

For polycoder's pipeline orchestrator, the equivalent rules:

- **Don't peek**: Orchestrator doesn't read a role's intermediate state
  during the role's run. Wait for the role to complete and emit its
  structured envelope.
- **Don't race**: Orchestrator never invents what a role *would* say
  before the role has spoken. If a downstream role needs upstream output,
  block until it arrives.

In a single-machine pipeline these are easier than in Claude Code's
distributed agent mesh — but the *prompt-level* discipline is the same:
each role's system prompt forbids it from speculating about what other
roles have or will produce.

---

## 6. Verification has explicit independence rules

**Source**: `src/constants/prompts.ts` lines 391-394, `src/coordinator/coordinatorMode.ts` lines 220-228

The internal "Verification Agent" (feature-flagged, ant-only) carries a
strong contract:

> *"Independent adversarial verification must happen before you report
> completion — regardless of who did the implementing... Your own checks,
> caveats, and a fork's self-checks do NOT substitute — only the verifier
> assigns a verdict; you cannot self-assign PARTIAL... On PASS: spot-check
> it — re-run 2-3 commands from its report... If any PASS lacks a command
> block or diverges, resume the verifier with the specifics."*

And in coordinator mode:

> *"Run tests with the feature enabled — not just 'tests pass'... Be
> skeptical — if something looks off, dig in. Test independently — prove
> the change works, don't rubber-stamp."*

Two principles:
1. **Self-verification is forbidden** — the implementer cannot also be the
   verifier.
2. **Adversarial mindset required** — the verifier's job is to *prove
   it works*, not confirm it exists.

### What polycoder adopts

- **Adversary and Validator must use a different model than Coder**
  (enforced by orchestrator + warning in UI).
- **Spot-check rule applies to Long-term Critic**: when a prior round's
  Adversary said "this is fine," and Long-term Critic disagrees in a
  later round, the discrepancy is surfaced to the user (selective
  transparency L1).
- **No model can review its own output**. If user assigns the same model
  to Coder and Adversary, the orchestrator inserts a synthetic "this
  judgment is from the same model that wrote the code" warning.

This becomes ADR-011 (see decisions.md).

---

## 7. Sub-agent definitions are first-class, with allowlists

**Source**: `src/tools/AgentTool/loadAgentsDir.ts`, `prompt.ts` lines 15-46

Each agent type has:

```typescript
{
  agentType: string                  // "explore", "verification", "general-purpose"
  whenToUse: string                  // single-line description of when to use
  tools?: string[]                   // allowlist of tools available
  disallowedTools?: string[]         // denylist
  mcpServers?: McpServerSpec[]       // agent-specific MCP servers
  systemPrompt: string
  // ...
}
```

When the agent runs, only tools matching the allowlist (or excluded by the
denylist) are visible to it. So the Explore agent can read files but not
edit them; the Verification agent can run bash but not write code; etc.

### What polycoder adopts directly

This is exactly what each polycoder role needs. Each role definition in
polycoder should follow this shape:

```typescript
type RoleDefinition = {
  role: RoleType                     // "translator" | "coder" | "adversary" | ...
  whenToUse: string                  // for orchestrator's reference
  allowedTools: ToolName[]           // strict allowlist
  systemPromptStatic: string         // cacheable prefix
  inputSchema: ZodSchema             // structured input from prior role
  outputSchema: ZodSchema            // structured output to next role
  defaultModelHints: ModelHint[]     // recommendations (not requirements)
}
```

V0 role tool allowlists (proposed):

| Role | Allowed Tools |
|------|---------------|
| Translator | `ask_user_question` |
| Designer | `read_file`, `read_design_tokens` |
| Architect | `read_file`, `read_project_memory`, `update_project_memory` |
| Coder | `read_file`, `write_file`, `edit_file`, `read_project_memory` |
| Adversary | `read_file`, `read_project_memory` |
| Long-term Critic | `read_file`, `read_project_memory`, `read_history` |
| Test Runner | `read_file`, `write_file` (test files only), `bash` (test commands only), `read_project_memory` |
| Communicator | `read_project_memory` |

Notice: **only Coder writes production code; only Test Runner writes
tests**. Adversary cannot edit code — it can only critique. This
enforced separation is exactly the kind of structural constraint that
Claude Code's allowlist mechanism makes possible.

This becomes ADR-008 (see decisions.md).

---

## 8. The DEFAULT_AGENT_PROMPT — what a sub-agent sounds like

**Source**: `src/constants/prompts.ts` line 758

```
You are an agent for Claude Code, Anthropic's official CLI for Claude.
Given the user's message, you should use the tools available to complete
the task. Complete the task fully—don't gold-plate, but don't leave it
half-done. When you complete the task, respond with a concise report
covering what was done and any key findings — the caller will relay this
to the user, so it only needs the essentials.
```

Three key directives in two sentences:

1. **"Complete the task fully — don't gold-plate, but don't leave it
   half-done"** — anti-laziness and anti-over-engineering simultaneously.
2. **"Concise report"** — output is for relay, not for the user
   directly. So no preamble, no "let me think about this," no padding.
3. **"Caller will relay"** — frames the agent as upstream of the user,
   not the user themselves. Important: it stops the agent from writing
   ChatGPT-style "I hope this helps!" filler.

### What polycoder adopts

Every role's prompt opens with the polycoder equivalent:

> *"You are the [Role] for polycoder. Your output is consumed by the next
> role in the pipeline, not the user. Be specific and structured. No
> preamble, no commentary on your own process — just the structured
> output. The Communicator will translate to the user."*

This single framing change matters a lot for output quality. Without it,
roles tend to add "Let me analyze this..." style filler that wastes
tokens and pollutes the next role's input.

---

## 9. Anti-fabrication and anti-sycophancy directives

**Source**: `src/constants/prompts.ts` lines 240, 227-229

Two directives stand out, both ant-only (internal):

```
Report outcomes faithfully: if tests fail, say so with the relevant
output; if you did not run a verification step, say that rather than
implying it succeeded. Never claim "all tests pass" when output shows
failures, never suppress or simplify failing checks (tests, lints, type
errors) to manufacture a green result, and never characterize incomplete
or broken work as done.
```

```
If you notice the user's request is based on a misconception, or spot a
bug adjacent to what they asked about, say so. You're a collaborator,
not just an executor — users benefit from your judgment, not just your
compliance.
```

These are explicitly framed in user-facing language ("the user benefits
from your judgment"). They make the LLM's collaboration model explicit.

### What polycoder adopts

Both directives go into the static prefix of every role prompt. They're
universal.

Specifically for **Adversary** and **Long-term Critic**, we strengthen the
anti-sycophancy directive: their *job* is to disagree. We add:

> *"Disagreement is your output. Silence is failure. If you find nothing
> to flag, say so explicitly with reasoning — silence will be interpreted
> as not having checked."*

This avoids the common failure mode where adversarial roles produce empty
"looks good" outputs because they're reaching for cooperative behavior.

---

## 10. Quantitative length anchors over qualitative

**Source**: `src/constants/prompts.ts` lines 530-536

> *"Length limits: keep text between tool calls to ≤25 words. Keep final
> responses to ≤100 words unless the task requires more detail."*

The comment notes:
> *"Numeric length anchors — research shows ~1.2% output token reduction
> vs qualitative 'be concise'."*

That's an internal eval result. **Numbers beat adjectives** for output
length control.

### What polycoder adopts

For each role, we set numeric anchors:

| Role | Output budget |
|------|---------------|
| Translator | spec JSON ≤500 tokens |
| Designer | design spec ≤800 tokens |
| Architect | memory delta ≤500 tokens, refactor instructions ≤500 tokens |
| Coder | code diff (no anchor — task-driven) |
| Adversary | issues list, each ≤50 words; max 10 issues |
| Long-term Critic | health snapshot ≤300 tokens |
| Test Runner | test results JSON (no anchor — task-driven) |
| Communicator | user-facing summary ≤150 words |

Rationale: vibe coders are non-technical; long technical output drowns
them. Anchors keep the Communicator output specifically tight.

---

## 11. The agent loop reads ToolUseContext at every turn — context propagates richly

**Source**: `src/Tool.ts` ToolUseContext type (lines 158-300)

The `ToolUseContext` passed to every tool call carries:

- Session state (messages, app state, file state cache)
- Permission context (which tools can run, in which mode)
- Notification handlers (for user-facing pings)
- Hook handlers (PreToolUse/PostToolUse user hooks)
- Subagent metadata (`agentId`, `agentType`)
- Telemetry callbacks
- Frozen system prompt (cache-friendly)
- Denial tracking (per-agent local copy for async agents)
- File history state, attribution state, content replacement state

This is dense but principled — every tool gets the full machinery of the
session, scoped per agent.

### What polycoder adopts

A simpler `RoleExecutionContext` for V0:

```typescript
type RoleExecutionContext = {
  role: RoleType
  workspace_id: string
  iteration_id: string
  prior_role_outputs: Record<RoleType, RoleOutput>  // upstream outputs
  project_memory: ProjectMemory
  abort_signal: AbortSignal
  emit_event: (event: PipelineEvent) => void  // for streaming UI updates
  cost_tracker: CostTracker
}
```

We deliberately drop most of Claude Code's flags (no `denialTracking`,
no `fileHistory`, no `setAppState`) because polycoder's pipeline is
simpler — fixed roles, fixed order, no user permission prompts mid-run
(user reviews after the pipeline completes).

---

## 12. The Skills system: micro-agents with their own prompts

**Source**: `src/skills/`, `src/services/skillSearch/`

Claude Code has "skills" — packaged sub-prompts the model invokes via a
SkillTool. Each skill has:

- A name (e.g., `/commit`, `/simplify`, `/verify`)
- A description (one-line trigger)
- A full prompt body (the skill's instructions)
- Often: associated tools, file references, examples

Skills are like macro-roles — when the model calls `SkillTool({skill:
'commit'})`, the skill's prompt gets expanded inline.

### What polycoder *might* adopt later (not V0)

The skill pattern could be polycoder's path to user customization. A user
could write a `polycoder-skill-payment-flows.md` that teaches the Coder
role about Stripe-specific patterns. The Coder role's prompt would
include `If a user prompt mentions payments, invoke the payment-flows
skill.`

V0 doesn't need this — we have 8 fixed roles. But this is a clean v2+
extensibility path.

---

## What we explicitly chose NOT to adopt

- **Prompt cache management complexity**. Claude Code has elaborate machinery for prompt cache stability (boundary markers, attachment-based dynamic content, frozen system prompts forked between agents). For polycoder V0 we accept some cache misses; the BYOK economics in our target market (DeepSeek/GLM/Qwen) absorb the cost.

- **The 30-method UI rendering API on Tool**. polycoder is Electron+React; UI lives in component files, not on the tool object.

- **Feature flags everywhere** (`feature('KAIROS')`, `feature('PROACTIVE')`, etc.). Claude Code is a mature product with many in-flight experiments. polycoder is V0 — no feature flags until we have data to A/B against.

- **Fork subagents** (sharing parent context for cache reuse). Our roles are sequential and need fresh, role-specific context anyway.

- **Plan mode as a separate agent state**. Our pipeline is implicitly always in "plan first, then execute" via Translator → Architect → … flow.

---

## Top 5 takeaways for polycoder, ranked

1. **Workers are role-bound, not freeform.** Each role has a fixed
   allowlist of tools and a fixed output schema. This is exactly Claude
   Code's `AgentDefinition` model and it's the right primitive for us.

2. **Synthesis discipline is the orchestrator's most important
   responsibility.** "Never delegate understanding." For polycoder, this
   means the orchestrator (and Architect role specifically) must produce
   concrete instructions when patching mismatches between roles, never
   "based on the prior round's findings."

3. **Verification independence is non-negotiable.** Coder and Adversary
   must be different models. The orchestrator should warn the user if
   they configure the same model for both. This is ADR-011.

4. **Inter-role communication uses XML envelopes, not free text.**
   Following `<task-notification>` pattern. Schema-enforced. Disagreements
   are first-class fields, not buried in prose.

5. **Quantitative length anchors > qualitative ones.** Each role gets
   explicit token/word budgets per output field.
