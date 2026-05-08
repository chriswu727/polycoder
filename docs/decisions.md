# Architecture Decision Log

A running log of design decisions and the reasoning behind them. Each entry
is structured as: **Context → Decision → Rationale → Consequences**.

If a decision is later reversed, do not delete the original entry — append a
new ADR that supersedes it. Decision history is information.

---

## ADR-001: V0 ships all 8 roles, not a subset

- **Date**: 2026-05-07
- **Status**: Accepted

### Context

Initial design proposed shipping V0 with 5 roles (Translator, Coder,
Adversary, Test Runner, Communicator) and deferring Designer / Architect /
Long-term Critic to V1. Argument: smaller surface area, faster validation.

### Decision

Ship all 8 roles in V0.

### Rationale

The project's thesis is *"multi-model collaboration produces apps that
survive MVP→production evolution."* The three deferred roles (Architect,
Long-term Critic, Designer) are exactly the roles that produce
evolution-survivability:

- **Architect** maintains the project memory that prevents pattern drift
- **Long-term Critic** applies refactor pressure that single-model tools lack
- **Designer** allows separation of UI judgment from code generation

Without these three roles, V0 is just another multi-agent coding tool
indistinguishable from MetaGPT — and the thesis cannot be validated.
Shipping a subset would invalidate the benchmark before we run it.

### Consequences

- V0 engineering scope is larger; we accept the cost
- The Iteration Survival Test benchmark in v0.2 must be designed to isolate
  each role's contribution (which roles can be ablated without quality loss?)

---

## ADR-002: Selective transparency, not full transparency

- **Date**: 2026-05-07
- **Status**: Accepted

### Context

How much of the multi-model "discussion" do we expose to the user? Two
extremes:

- **Hide everything** → users perceive the product as "another Cursor";
  multi-model differentiation is invisible
- **Show everything** → information overload; vibe coders are non-technical
  and will be drowned by 8 streams of model output

### Decision

Three visibility tiers:

| Tier | Content                                                    | Default        |
|------|------------------------------------------------------------|----------------|
| L1   | Final code, test results, disagreements, model badges, cost | Always visible |
| L2   | Per-role full I/O traces, bug descriptions, future-risk    | Expandable     |
| L3   | Prompt templates, retries, latency                         | Debug only     |

### Rationale

- L1 *disagreements* are the unique value (Lovable hides them; we expose them)
- L2 satisfies the "show me you're really doing multi-model" gut check
- L3 keeps the implementation auditable without polluting the default UI

### Consequences

- Disagreement-detection logic is on the critical path of every pipeline run
- UI complexity higher than chat-only interface
- Pipeline must produce structured outputs (not free-form text) so
  disagreements are detectable

---

## ADR-003: Custom Provider Abstraction over LiteLLM

- **Date**: 2026-05-07
- **Status**: Accepted

### Context

Multi-provider LLM access can be implemented via the LiteLLM library
(unified interface for ~100 providers) or a homegrown abstraction layer.

### Decision

Build a homegrown abstraction layer.

### Rationale

- LiteLLM has inconsistent support for Chinese providers (DeepSeek OK,
  GLM/Qwen often lag the official APIs by versions)
- Cost tracking is normalized inconsistently across LiteLLM adapters
- Streaming behavior varies per provider, breaking pipeline assumptions
- A custom layer is small (~300 LOC) and is a tangible engineering artifact
  for the project portfolio
- Tighter control over Chinese providers is essential given the target market

### Consequences

- We own all provider-adapter maintenance
- Adding a new provider requires writing an adapter (≈50 LOC)
- We have full control over error taxonomy and retry semantics

---

## ADR-004: BYOK with Secret-by-reference data model

- **Date**: 2026-05-07
- **Status**: Accepted

### Context

How are user-supplied API keys mapped to roles? Two patterns:

- **Inline**: each `RoleAssignment` contains its own `api_key` field
- **Reference**: `Secret` is a separate entity with a UUID; `RoleAssignment`
  references it by ID

### Decision

Reference-based. Secrets are first-class entities; RoleAssignment holds a
foreign key.

### Rationale

- Inlining keys means rotating one key requires editing 8 RoleAssignments
- Reference enables enterprise scenarios where one credential serves many
  roles (common: company has one Aliyun account → 5 roles use it)
- Decouples credential lifecycle from role lifecycle (delete a Secret
  without deleting all assignments using it)
- Mirrors how production systems handle credentials (AWS, Vercel, etc.)

### Consequences

- Need cascading update logic when Secrets are deleted (orphaned
  RoleAssignments must be flagged in UI)
- Slightly more complex data model
- Worth it: this is the right shape; inlining is the legacy mistake

---

## ADR-005: Desktop-first deployment

- **Date**: 2026-05-07
- **Status**: Accepted

### Context

Web app, desktop app, or hybrid for MVP?

### Decision

Desktop app (Electron) for MVP. Cloud/web deferred to v1+.

### Rationale

- Zero ops cost during validation phase (no servers to run)
- API keys never leave the user's machine — eliminates key-leak liability
- Avoids ICP备案 friction in Chinese market
- OS keychain integration is more secure than DIY web encryption
- Lower distribution friction in China than a hosted SaaS (no DNS issues)

### Consequences

- Distribution requires installer building (Mac DMG, Windows installer)
- No browser-only access path
- No multi-device sync until cloud version is added
- Auto-update mechanism needs to be designed (Squirrel for Mac, MSI for Win)

---

## ADR-006: Working name `polycoder`

- **Date**: 2026-05-07
- **Status**: Provisional (placeholder)

### Context

Project name needed before repo creation. Existing project naming convention
in user's `~/Projects` favors single-word evocative names (argus, eidolon,
sibyl). However, choosing a final name should not block bootstrap.

### Decision

Use `polycoder` as a working/placeholder name. Mark as subject to rename.

### Rationale

- Descriptive and unambiguous (multi-model coder)
- Available on chriswu727's GitHub
- Easy to rename later (single-word, low SEO entanglement)

### Consequences

- All references in docs flagged as placeholder
- Final naming decision deferred until V0.2 (post-validation)

---

## ADR-007: Coordinator/Worker pattern, role-bound workers

- **Date**: 2026-05-08
- **Status**: Accepted
- **Informed by**: Claude Code's `coordinator/coordinatorMode.ts` (see
  [`claude-code-learnings.md` §1](./claude-code-learnings.md#1))

### Context

How is the multi-role pipeline orchestrated internally? Two extremes:

- **Free-form multi-agent debate**: any role can invoke any other; loops
  terminate when consensus or budget reached. Flexible but unbounded
  cost; hard to reason about.
- **Fixed pipeline with no orchestrator intelligence**: dumb runner steps
  through roles in order. Predictable but can't recover from upstream
  errors or surface conflicts.

Claude Code's coordinator/worker pattern is a middle ground: a
coordinator that decides what to dispatch, with workers that execute
bounded tasks.

### Decision

polycoder's pipeline orchestrator is a **coordinator** that:

- Dispatches role invocations in a fixed order (V0)
- Reads each role's structured output and decides whether to proceed,
  retry with corrected input, or surface a conflict to the user
- Never executes role work itself — delegates everything

Each role is a **role-bound worker**:

- Has a fixed allowlist of tools (no role can access tools outside its
  scope; e.g. Adversary cannot edit code)
- Has a fixed input schema (Zod-validated)
- Has a fixed output schema (Zod-validated)
- Cannot invoke other roles (only the orchestrator can)

### Rationale

- Constrains the cost surface: with N roles each fixed in scope, the
  upper bound on a single iteration's cost is predictable and capped.
- Makes the system testable: each role has a defined contract.
- Mirrors the production-grade pattern Claude Code itself uses, which
  is a strong signal of viability.
- Allows conflict surfacing (selective transparency) — the orchestrator
  is the only entity with a view of all role outputs.

### Consequences

- Orchestrator code becomes substantial — it owns the conflict-detection
  and pipeline-flow logic.
- New roles cannot be added by users in V0 (extending the role set
  requires code changes). V1+ may add user-defined roles via a manifest
  file similar to Claude Code's `loadAgentsDir`.

---

## ADR-008: Tool framework with metadata flags

- **Date**: 2026-05-08
- **Status**: Accepted
- **Informed by**: Claude Code's `Tool.ts` and per-tool prompt files (see
  [`claude-code-learnings.md` §2, §7](./claude-code-learnings.md#2))

### Context

Roles need to call tools (read files, edit files, run bash, query memory,
etc.). How are tools defined, registered, and assigned to roles?

### Decision

A tool framework matching Claude Code's shape, simplified to V0 scope:

```typescript
type ToolDef<I, O> = {
  name: string
  description: string                     // shown to the model
  inputSchema: ZodSchema<I>
  outputSchema: ZodSchema<O>
  call: (input: I, ctx: ToolContext) => Promise<O>
  isReadOnly: (input: I) => boolean       // drives default permission
  isConcurrencySafe: (input: I) => boolean
  // V0 stops here. V1+: isDestructive, shouldDefer, searchHint, ...
}

function buildTool<I, O>(def: ToolDef<I, O>): Tool<I, O>
```

Per-role allowlists in role definitions:

```typescript
type RoleDefinition = {
  role: RoleType
  allowedTools: ToolName[]          // strict allowlist
  systemPromptStatic: string         // cacheable prefix
  inputSchema: ZodSchema
  outputSchema: ZodSchema
  defaultModelHints: ModelHint[]
}
```

V0 tools (10 total): `read_file`, `write_file`, `edit_file`, `bash`,
`read_project_memory`, `update_project_memory`, `read_history`,
`ask_user_question`, `read_design_tokens`, `run_test_suite`.

### Rationale

- The metadata-flag pattern is a proven primitive (Claude Code uses it).
- Allowlists per role make role isolation **structurally enforced**, not
  prompt-conventional. Adversary literally cannot edit code; the tool
  isn't visible to it.
- Tool framework is independent of model framework — adding a new
  provider doesn't touch tools.

### Consequences

- Each tool is ~50-150 LOC including schema and tests.
- Total V0 tool implementation: ~1000 LOC.
- Permissions logic is simple in V0 (no per-tool permission prompts,
  since pipeline runs through to completion before user reviews) —
  defer Claude Code's permission complexity to V1.

---

## ADR-009: System prompt cache boundary per role

- **Date**: 2026-05-08
- **Status**: Accepted
- **Informed by**: Claude Code's `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` (see
  [`claude-code-learnings.md` §3](./claude-code-learnings.md#3))

### Context

When the same provider+model is assigned to multiple roles (common in
Budget/China Pro presets where DeepSeek-V3 covers 5+ roles), prompt
caching could substantially reduce cost — *if* the static prefix of each
role's system prompt is byte-identical across calls.

### Decision

Each role's system prompt is composed in two parts:

```
[STATIC PREFIX]
- Role identity
- Output schema (JSON)
- Operating principles
- Anti-patterns
- Examples

___POLYCODER_PROMPT_BOUNDARY___

[DYNAMIC SUFFIX]
- Project memory snapshot (changes per iteration)
- Prior role outputs (changes per iteration)
- Current iteration metadata (timestamp, attempt #)
```

Per-iteration data goes in **user messages**, not the system prompt.
This way, the system prompt is byte-stable across iterations within a
session, maximizing cache hits.

### Rationale

- Claude Code reports ~10% cache_creation token reduction from this
  pattern alone.
- Our cost model (BYOK on cheap providers) tolerates cache misses, but
  the engineering effort to enable caching is small (just keep dynamic
  data out of the static section).

### Consequences

- Static prefix must not depend on workspace-specific config. If a user
  customizes a role's prompt (override mechanism in V0.4), that user's
  cache becomes per-workspace — acceptable.
- Boundary marker is a literal string. Documented and tested.

---

## ADR-010: XML-tagged inter-role communication

- **Date**: 2026-05-08
- **Status**: Accepted
- **Informed by**: Claude Code's `<task-notification>` envelope (see
  [`claude-code-learnings.md` §1](./claude-code-learnings.md#1))

### Context

How does role N's output reach role N+1? Three options:

- **Free-form text**: role N produces prose; role N+1 parses it. Brittle.
- **Structured JSON only**: role N emits JSON; role N+1 reads JSON. Loses
  the "this is from role X about iteration Y" framing in the prompt.
- **XML envelope wrapping JSON payload**: role N emits a tagged envelope
  with metadata; role N+1 sees both metadata and content. This is what
  Claude Code does for `<task-notification>`.

### Decision

Inter-role messages use an XML envelope:

```xml
<role-output role="adversary" iteration="3" model="qwen-max">
  <status>flagged</status>
  <summary>Found 3 issues, 1 critical</summary>
  <payload>
    {
      "issues": [...],
      "confidence": 0.85
    }
  </payload>
  <usage>
    <input_tokens>1234</input_tokens>
    <output_tokens>567</output_tokens>
    <duration_ms>4321</duration_ms>
  </usage>
</role-output>
```

Schema-validated payload. The envelope itself is parseable by simple
regex; the payload is JSON-validated against the role's output schema.

### Rationale

- Mirrors Claude Code's working pattern; reduces invention risk.
- The envelope's metadata (role, model, iteration, status) is exactly
  what the orchestrator needs for conflict detection and UI display.
- LLMs reliably produce well-formed XML when prompted with explicit
  closing-tag examples (Claude Code's evidence).

### Consequences

- Each role's output prompt teaches the envelope format with examples.
- Orchestrator parses envelopes; payloads validated by Zod.
- Deviations (unclosed tags, schema mismatches) trigger an automatic
  retry with a corrective prompt up to N=2 attempts before failing.

---

## ADR-011: Verification independence — different model required

- **Date**: 2026-05-08
- **Status**: Accepted
- **Informed by**: Claude Code's verification agent contract (see
  [`claude-code-learnings.md` §6](./claude-code-learnings.md#6))

### Context

The product thesis depends on Adversary actually finding bugs the Coder
missed. If the same underlying model serves both Coder and Adversary,
they share blind spots and cognitive style — the Adversary becomes
self-review, which Claude Code's documented contract explicitly forbids.

### Decision

Hard rules enforced by orchestrator + UI:

1. **Coder's model and Adversary's model must differ** (provider OR
   model — not just same provider with different model_ids).
2. **Coder's model and Test Runner's model must differ** (a model
   should not validate its own implementation).
3. **Long-term Critic should use a model with strong reasoning** (default:
   Claude Opus / Qwen-Max / GLM-4-Plus). Cheap-model assignment is
   permitted but a soft warning shown.
4. UI surface: **red warning banner** in Team Configuration if a user's
   assignment violates rule 1 or 2. Pipeline still runs, but the
   workspace's transparency display labels the iteration as
   `verification_compromised`.

### Rationale

- The whole project's value proposition is multi-model adversarial review.
  Allowing self-review silently breaks the core claim.
- Claude Code's explicit rule ("only the verifier assigns a verdict; you
  cannot self-assign PARTIAL") is the production-grade pattern.
- Soft enforcement (warning + label) preserves user choice while making
  the consequences visible.

### Consequences

- The four cheap-mode presets must be designed around this constraint
  (e.g. Budget preset can't be 100% DeepSeek — needs at least 2 distinct
  providers).
- Users with only one provider's keys will see warnings on every
  iteration. Documentation must explain why.

---

## ADR-012: Synthesis discipline — Architect cannot delegate understanding

- **Date**: 2026-05-08
- **Status**: Accepted
- **Informed by**: Claude Code's coordinator synthesis principle (see
  [`claude-code-learnings.md` §1](./claude-code-learnings.md#1))

### Context

Claude Code's coordinator prompt has an emphatic rule: *"Never delegate
understanding. Don't write 'based on your findings, fix the bug.'
Synthesize the findings yourself; produce a prompt with specific file
paths and line numbers."*

In polycoder, the analog is the **Architect role**, which receives:
- Translator's spec
- Adversary's flagged issues
- Long-term Critic's tech-debt observations
- Prior project memory

…and must produce concrete pattern guidance that downstream Coder uses.

### Decision

The Architect role's system prompt explicitly forbids:

- "Based on the previous role's findings…"
- "Following the patterns identified earlier…"
- "Per the architectural memory…" (without quoting/specifying *what*)

Required pattern: the Architect must restate the relevant facts
(file paths, line numbers, specific patterns) in its output, even if
they appeared in a prior role's output. The Coder and downstream roles
should not need to read prior role outputs to act on Architect's output —
Architect's output should be self-contained.

### Rationale

- Without this discipline, the Architect becomes a passthrough that
  doesn't add value (the Coder could just read the Adversary's report
  directly).
- Claude Code's explicit experience: lazy synthesis is the most common
  multi-agent failure mode.
- Forces the Architect to actually engage with cross-role reconciliation
  rather than papering over disagreements.

### Consequences

- Architect's output is verbose by design — this is the role where
  redundancy is good.
- Token budget for Architect's output is set higher (1000 tokens vs.
  Translator's 500) to accommodate restated facts.
- Anti-pattern detection in the orchestrator: if Architect output
  contains phrases matching `/based on (the |)(prior|previous|earlier)/i`,
  flag it for re-prompt.

---

## ADR-013: Use pnpm (not bun) as package manager

- **Date**: 2026-05-08
- **Status**: Accepted
- **Resolves**: `todo.md` Open Questions item #2

### Context

`todo.md` Layer A.1 left the package-manager choice open between
**bun**, **pnpm**, and **npm**, with bun as the soft recommendation
(fast, single binary, native test runner).

At implementation time:

- bun was **not installed** on the dev machine
- pnpm was already installed (`/opt/homebrew/bin/pnpm`)
- node v25.6.1 present

### Decision

Use **pnpm**. Engines pinned to `node >= 20.10.0`, `pnpm >= 9.0.0`.
Not bun.

### Rationale

1. **Already installed** — zero-install ramp-up.
2. **Electron + native modules** — pnpm has years of battle-tested
   support for Electron's native rebuilds (better-sqlite3, keytar)
   that bun is still maturing on.
3. **China mirror friendliness** — `.npmrc` with the npmmirror.com
   registry is a one-liner with pnpm; bun's package mirror story is
   less documented.
4. **Test runner** — vitest is more mature than `bun:test` for our
   use case (mocking, UI, snapshot testing). The "bun's native test
   runner" advantage didn't apply.
5. **Workspace handling** — pnpm workspaces are well-tested. We may
   not need them in V0.1 (single package), but the upgrade path is
   clean.

### Consequences

- Slightly slower install than bun (still fast in practice — ~3s for
  ~160 packages on cold cache).
- One more tool dependency users must have to develop polycoder
  (mitigated by `packageManager` field in `package.json` — Corepack
  can auto-install).
- Decision can be revisited at V1.0 if bun's Electron story matures.

---

## ADR-014: Pin Vite to v7 (avoid rolldown native-binding issues)

- **Date**: 2026-05-08
- **Status**: Accepted (revisitable)

### Context

Initial scaffolding (A.2) installed `vite@^8.0.0`, which was the
latest. Vite 8 ships with `rolldown@1.0.0-rc.18` as its default
bundler — rolldown is Vite's Rust-rewrite of rollup, currently
release-candidate.

After pushing Layers A-C, GitHub Actions CI failed every run on the
`pnpm build:renderer` step:

```
Cannot find module '@rolldown/binding-linux-x64-gnu'
Cannot find module '../rolldown-binding.linux-x64-gnu.node'
```

The pnpm lockfile listed all per-platform rolldown bindings as
optional deps, and `supported-architectures` in `.npmrc` was added
to ensure the lockfile resolves them across darwin/linux/win32. But
on Linux CI, even with the binding listed in the lockfile, pnpm's
node-linker layout placed the .node file somewhere rolldown's
runtime loader couldn't find it.

This is a known interop issue between pnpm's symlinked node_modules
and packages with per-platform optional native bindings, particularly
when the package is in pre-release. Workarounds (shamefully-hoist,
node-linker=hoisted, public-hoist-pattern) exist but each has costs.

### Decision

Pin Vite to `^7.0.0`. Don't upgrade to Vite 8 until rolldown ships
stable + pnpm interop has well-documented patterns.

### Rationale

- Vite 7 uses esbuild + rollup (proven, stable, no native-binding
  pnpm interop issues).
- Bundle size is comparable: 193KB JS vs 191KB on Vite 8 — 1%
  difference is not material for V0.
- CI green is a hard requirement; chasing rolldown-pnpm interop in
  V0 is unjustified risk.
- Vite 7 supports React 19, Tailwind v4, and shadcn/ui — same
  feature surface we need.

### Consequences

- We don't get rolldown's build-time speed advantage (~3-5× faster
  on large codebases). For V0 codebase size (<500 modules), the
  difference is sub-second and not noticed.
- When Vite 8 + rolldown matures (~2026 H2 likely), revisit. ADR
  amendment not required for the upgrade — just update package.json
  and re-verify CI.
- `supported-architectures` in `.npmrc` retained for future-proofing
  (also helps better-sqlite3 lockfile portability).

---

## ADR-015: Pin Electron to ^34.x (better-sqlite3 v12 native compat)

- **Date**: 2026-05-08
- **Status**: Accepted (revisitable)

### Context

Initial scaffolding (A.3) installed `electron@^42.0.0` (latest at the
time). When packaging the app via `electron-builder` (`pnpm dist:dir`),
`@electron/rebuild` failed to build `better-sqlite3@12.9.0` against
Electron 42's V8 headers:

```
src/better_sqlite3.cpp:60:65: error: too few arguments to function
call, expected 3, have 2
   60 |   v8::Local<v8::External> data = v8::External::New(isolate, addon);
```

Electron 42 ships a newer V8 in which `External::New` requires a
`ExternalPointerTypeTag` argument. better-sqlite3 12.9 hasn't been
updated for it.

### Decision

Pin Electron to `^34.0.0`. Don't upgrade further until either:

1. better-sqlite3 ships a release that supports Electron 42's V8 API
2. We migrate to a different SQLite binding (libsql, `node:sqlite` —
   the new Node 22+ built-in, or a wasm fallback)

### Rationale

- Electron 34 (Jan 2025 line) is widely adopted and has prebuilt
  binaries for `better-sqlite3` + `keytar`
- `pnpm dist:dir` succeeds; the produced `.app` is ~290MB (typical)
- Tests run against Node, so this only affects packaging

### Consequences

- Devs working on packaging must `pnpm rebuild better-sqlite3 keytar`
  after a `pnpm dist:*` build to restore Node-compatible native
  binaries (electron-rebuild swaps them in-place).
- `node:sqlite` (built-in to Node 22+) is a future migration path
  that would eliminate the native-module rebuild dance entirely.
  Considered for V1.0.

---

## ADR-016: IST coder-only control runs Coder every iter, no Architect ever

**Date**: 2026-05-07
**Status**: Accepted
**Resolves**: open question 4 from
  [`specs/iteration-survival-test.md`](./specs/iteration-survival-test.md) §12

### Context

The IST `polycoder-coder-only` system is an internal control: same
model as `polycoder-full`'s Coder role, different orchestration.
Two designs were on the table:

- **A. No Architect ever.** Coder runs alone every iter, with the
  raw user prompt. No upstream Translator/Designer/Architect, no
  downstream reviewers.
- **B. Architect on iter 1, Coder-only on iters 2-5.** A
  one-time architectural framing, then per-iter is Coder-only.

### Decision

Adopt **A — no Architect ever**.

### Rationale

- A is the cleanest, strongest contrast with `polycoder-full`. If
  full beats A, the headline finding is unambiguous: "the
  multi-role pipeline (whatever combination of memory framing,
  per-iter review, and team composition) provides the
  contribution."
- B introduces a 4-way comparison with extra confounds (was it
  the iter-1 framing or the per-iter pipeline that mattered?). A
  3-way is enough for V0.2's signal-to-effort budget.
- The IST is a portfolio artifact, not a paper. Cleaner narrative
  > more granular ablation.
- If the V0.2 results show A losing, B becomes the natural
  follow-up experiment. We can leave it for V0.2-stretch or V0.3.

### Consequences

- `benchmarks/ist/runners/coderOnly.ts` calls `invokeRole(Coder)`
  directly with the user prompt as the input envelope.
- No project-memory write-back happens for the coder-only system
  (Architect's `memory_updates` are the only mechanism that writes
  memory; coder-only never invokes Architect).
- Coder cost is roughly 1/8 of polycoder-full's cost. Total
  coder-only IST cost estimate: ~$1 USD across 15 iters.
