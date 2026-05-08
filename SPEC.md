# polycoder — Design Specification

> **Working name**: `polycoder` (placeholder, subject to rename)
> **Stage**: Design phase. No implementation yet.
> **Author**: chriswu727
> **Document version**: 0.1 — 2026-05-07

---

## 1. Vision

The "vibe coding" wave (Lovable, Bolt, v0, Cursor Composer, Replit Agent, Devin)
has made it possible for non-technical people to ship apps from natural-language
prompts. But these tools share a structural blind spot: **they optimize for the
first prompt's magic, not for what happens after.**

Vibe-coded apps reliably break by the 5th–7th iteration:

- Same logic implemented differently across files (no architectural memory)
- No tests, so feature additions cause silent regressions
- Tightly coupled code that requires full rewrites for any extension
- Tech debt rising monotonically until the app is unmaintainable

This is a **structural** problem, not a prompt-engineering one. Single-model
systems can't escape it because:

1. Each prompt is a fresh context — no project memory
2. The model has no incentive to refactor (user asks for X, model adds X)
3. There's no adversarial pressure to find tomorrow's bugs

`polycoder` addresses this with **multi-model collaboration**, where each model
serves a distinct cognitive function that single-model systems cannot
convincingly simulate.

The product thesis in one line:

> *Lovable builds your MVP. We build your MVP so it can grow into a real product.*

---

## 2. Target User

### Primary: Chinese-market vibe coders

- Lovable / Bolt / v0 / Cursor with Claude all unavailable or unreliable in China
- Domestic alternatives (通义灵码, Trae, CodeGeeX) target developers, not non-coders
- Domestic LLMs (DeepSeek, Qwen, GLM) are 10–50× cheaper than Western counterparts
- **Multi-model adversarial review is economically viable in China** in a way it
  isn't in the West — 4–5 domestic models cost less than one Claude Sonnet call

### Secondary: Anyone wanting fine-grained control over which model does what

- BYOK power users with credit across multiple providers
- Enterprises with provider contracts (e.g. "we have an Aliyun deal but also
  want to use Claude for select tasks") — these users *cannot* use locked-in
  tools like Cursor

### Anti-target

- Professional developers who already use Cursor / Claude Code productively.
  They don't need an opinionated multi-model pipeline; they want raw access.

---

## 3. Differentiation

| Existing tools                              | polycoder                                              |
| ------------------------------------------- | ------------------------------------------------------ |
| Single model behind black box               | Multi-model team with selective transparency           |
| Optimize for first MVP                      | Optimize for MVP→production evolution                  |
| Vendor-locked (Cursor=Claude, v0=GPT)       | BYOK + per-role custom assignment                      |
| Hide internal disagreements                 | Surface critical disagreements to the user             |
| No test enforcement                         | Test Runner role refuses code without tests            |
| Code only                                   | Architectural memory persisted across iterations       |
| MetaGPT/ChatDev: cooperative human-org sim  | Adversarial cognitive-function design                  |

---

## 4. Architecture

### 4.1 Roles

8 cognitive functions, each backed by a user-chosen model:

| # | Role             | Responsibility                                                  |
|---|------------------|-----------------------------------------------------------------|
| 1 | **Translator**   | Vibe coder's natural language → structured spec                 |
| 2 | **Designer**     | UI/UX layer (components, layout, design tokens)                 |
| 3 | **Architect**    | Maintains project memory + cross-prompt pattern consistency     |
| 4 | **Coder**        | Implementation                                                  |
| 5 | **Adversary**    | Adversarial bug hunter (immediate flaws, attack scenarios)      |
| 6 | **Long-term Critic** | Future-stress + refactor-aware review (long-term health)    |
| 7 | **Test Runner**  | Writes tests, runs them, enforces coverage                      |
| 8 | **Communicator** | Translates technical results into vibe coder's language         |

**Roles are cognitive functions, not human job titles.** There is no "CEO" or
"PM" role. Those add ceremony, not value. Every role here exists because it
performs a distinct cognitive function that a single model executing all roles
sequentially cannot reliably perform within one prompt.

### 4.2 Pipeline (V0)

```
User prompt
   ↓
[Translator]      →  structured spec (JSON)
   ↓
[Architect]       →  fetches project memory, returns pattern guidance
   ↓
[Designer]        →  UI/UX spec (parallel with Coder when independent)
   ↓
[Coder]           →  code diff
   ↓
[Adversary] ‖ [Long-term Critic] ‖ [Test Runner]   ← parallel
   ↓
[Conflict Resolution]   ← see §4.3
   ↓
[Communicator]    →  user-facing summary + diff explanation
   ↓
[Architect]       →  updates project memory with new decisions
   ↓
User reviews
```

V0 ships all 8 roles. See [ADR-001](./docs/decisions.md#adr-001) for why we
don't ship a subset.

### 4.3 Conflict Resolution

When two roles produce contradictory judgments — e.g. Adversary says "buggy"
but Test Runner says "all tests pass" — the conflict is **surfaced** rather
than internally resolved.

```
1. Both judgments shown side-by-side to the user
2. User makes the final call (or invokes a tiebreaker model)
3. Decision recorded in project memory for future consistency
```

This is a deliberate inversion of Lovable/Bolt's "single confident answer"
model. Vibe coders need *honest uncertainty*, not false confidence.

### 4.4 Selective Transparency

Three visibility tiers:

| Tier | What's shown                                                               | Default                          |
|------|---------------------------------------------------------------------------|----------------------------------|
| L1   | Final code, test results, disagreements, model badges, cost summary       | Always visible                   |
| L2   | Per-role full I/O trace, bug descriptions, future-risk predictions         | Click "View team discussion"     |
| L3   | Prompt templates, retries, step latency                                   | Debug mode only                  |

See [ADR-002](./docs/decisions.md#adr-002) for the rationale.

### 4.5 Provider Abstraction

All LLM calls go through a homegrown provider abstraction. **We do not use
LiteLLM**; see [ADR-003](./docs/decisions.md#adr-003).

```python
class ModelProvider(ABC):
    name: str
    cost_per_million_input: float
    cost_per_million_output: float
    context_window: int
    supports_vision: bool
    supports_tool_use: bool

    async def chat(messages, **opts) -> Response: ...
    async def stream(messages, **opts) -> AsyncIterator[Token]: ...
```

V0 adapters: DeepSeek, Qwen, GLM, OpenAI-compatible (covers Anthropic via
proxy, generic local LLMs, etc.).
V1+ adapters: Doubao, Kimi, MiniMax, Anthropic native, Google native.

Each adapter is responsible for normalizing:

- Auth (api_key + optional base_url)
- Streaming (yields uniform `Token` objects)
- Cost tracking (returns input/output token counts in standardized fields)
- Error mapping (provider-specific errors → uniform error taxonomy)

---

## 5. Data Model

### 5.1 Secret (credential)

```typescript
type Secret = {
  id: string                  // UUID, internal reference
  name: string                // user-defined label, e.g. "my-deepseek-personal"
  provider: ProviderType      // "deepseek" | "qwen" | "glm" | "openai-compat" | …
  api_key: string             // encrypted at rest (OS keychain)
  base_url?: string           // optional self-hosted / proxy endpoint
  available_models: string[]  // populated on connection test
  last_tested?: Date
  created_at: Date
}
```

### 5.2 Role Assignment

```typescript
type RoleType =
  | "translator" | "designer" | "architect" | "coder"
  | "adversary"  | "long_term_critic" | "test_runner" | "communicator"

type RoleAssignment = {
  role: RoleType
  secret_id: string | null                  // references Secret.id; null = unconfigured
  model_id: string | null                   // e.g. "deepseek-chat", "qwen-max"
  fallback?: { secret_id, model_id }
  custom_prompt_override?: string           // power-user feature
}
```

### 5.3 Workspace

```typescript
type Workspace = {
  id: string
  name: string
  secrets: Secret[]
  role_assignments: Record<RoleType, RoleAssignment>
  preset?: PresetId                         // see §7
  project_memory: ProjectMemory             // populated by Architect
  created_at: Date
}
```

### 5.4 Project Memory

Maintained by the Architect role. Persists across prompts within a workspace.

```typescript
type ProjectMemory = {
  conventions: {
    naming: string[]                        // e.g. "use camelCase for files"
    structure: string                       // directory layout description
    state_management: string                // e.g. "Zustand for global, React state for local"
    auth_pattern: string
    error_handling: string
  }
  decisions: Array<{
    timestamp: Date
    summary: string
    rationale: string
    superseded_by?: string                  // for tracking decision evolution
  }>
  pending_tech_debt: Array<{
    file: string
    issue: string
    flagged_by: RoleType
    severity: "low" | "medium" | "high"
  }>
}
```

### 5.5 Key Design Principle

`RoleAssignment.secret_id` is a **reference**, not inline. This means:

- Swapping a key updates one Secret; all roles using it auto-update
- Deleting a Secret cascades to flag dependent RoleAssignments as orphaned
- Enterprise users can provide one shared credential for many roles

See [ADR-004](./docs/decisions.md#adr-004).

---

## 6. UI Surfaces

### 6.1 Tab 1 — Secrets Manager

```
┌─ My API Keys ─────────────────────────────────────┐
│  Name              Provider    Status      Action │
│  ────────────────────────────────────────────────│
│  my-deepseek       DeepSeek    ✓ Verified  [Edit]│
│  my-glm-free       GLM         ✓ Verified  [Edit]│
│  work-qwen         Qwen        ⚠ Unused    [Edit]│
│                                                   │
│  [+ Add new credential]                          │
└───────────────────────────────────────────────────┘
```

**Add flow**: choose provider → enter name + key → optionally `base_url` →
click `Test Connection`. On success, populate `available_models` and mark
verified.

### 6.2 Tab 2 — Team Configuration

```
┌─ Configure Your AI Team ──────────────────────────────────────────┐
│  [ Quick Setup: ▾ Budget | China Pro | Mixed | Custom ]          │
│                                                                   │
│  Role             Credential        Model              Fallback  │
│  ────────────────────────────────────────────────────────────────│
│  Translator       [my-deepseek ▾]  [deepseek-chat ▾]  [None ▾]  │
│  Designer         [my-glm-free ▾]  [glm-4-plus ▾]     [None ▾]  │
│  Architect        [my-deepseek ▾]  [deepseek-chat ▾]  [None ▾]  │
│  Coder            [my-deepseek ▾]  [deepseek-coder ▾] [None ▾]  │
│  Adversary        [my-glm-free ▾]  [glm-4-plus ▾]     [None ▾]  │
│  Long-term Critic [my-deepseek ▾]  [deepseek-chat ▾]  [None ▾]  │
│  Test Runner      [my-deepseek ▾]  [deepseek-chat ▾]  [None ▾]  │
│  Communicator     [my-glm-free ▾]  [glm-4-flash ▾]    [None ▾]  │
│                                                                   │
│  [Advanced ▾]  Override prompt for individual roles…             │
└───────────────────────────────────────────────────────────────────┘
```

**Credential dropdown** lists only Secrets configured in Tab 1. **Model
dropdown** is filtered by the selected Secret's `available_models`. Selecting
a Quick Setup preset fills the entire table in one click.

### 6.3 Tab 3 — Workspace (main UI)

Chat-like interface. User types a prompt; the pipeline runs; the L1
transparency view is shown by default. Click "View team discussion" to expand
to L2.

Expanded discussion shows each role's input/output as a collapsible card,
ordered chronologically through the pipeline. Disagreement cards are
highlighted in amber.

---

## 7. Presets

| ID            | Strategy                  | Stack                                                           |
|---------------|---------------------------|-----------------------------------------------------------------|
| `budget`      | Cheapest viable           | DeepSeek-V3 most roles, GLM-Flash for Communicator              |
| `china_pro`   | Strong China-market mix   | Qwen-Max for Architect/Adversary, DeepSeek-Coder for Coder      |
| `mixed`       | Best of both worlds       | Claude Sonnet for Coder/Adversary, DeepSeek for cheap roles     |
| `custom`      | User configures manually  | —                                                               |

Presets fill the Role-Assignment table in one action. Users can edit any row
afterward; the preset becomes `custom` once any field diverges.

---

## 8. Storage & Security

- **Desktop app** (Electron) for MVP — see [ADR-005](./docs/decisions.md#adr-005)
- API keys stored in OS keychain:
  - macOS → Keychain Services
  - Windows → Credential Manager
  - Linux → Secret Service (libsecret)
- API keys never transmitted off-machine in MVP
- No accounts, no cloud sync in MVP
- Project memory and workspace state in local SQLite
- Web/cloud version deferred until MVP validated

---

## 9. Roadmap

### v0.1 — Skeleton
- [ ] Provider abstraction layer (DeepSeek, Qwen, GLM, OpenAI-compat adapters)
- [ ] Secret + Role Assignment data layer with encrypted local storage
- [ ] Settings UI (Secrets tab + Team Config tab)
- [ ] Hard-coded pipeline orchestration (8 roles, sequential V0 happy path)
- [ ] Basic L1 transparency (final output + disagreement cards)
- [ ] One end-to-end happy-path task (e.g. "build me a todo app")

### v0.2 — Validation
- [ ] **Iteration Survival Test** benchmark — 5 app templates × 10 iterations,
      compared against Lovable, Bolt, single-Claude
- [ ] Metrics dashboard: test-coverage maintenance rate, complexity growth
      curve, break-frequency-per-iteration
- [ ] L2 transparency (expandable team-discussion view)

### v0.3 — Local sandbox
- [ ] WebContainer integration for in-browser code execution (or e2b alternative)
- [ ] "Open in localhost" button — auto-runs the produced app

### v0.4 — Polish
- [ ] L3 debug mode
- [ ] Custom prompt-override UI
- [ ] Additional providers (Doubao, Kimi, MiniMax)
- [ ] Project-memory inspection / editing UI

### v1.0 — Public release
- [ ] Distribution: Mac DMG + Windows installer
- [ ] Tutorial walkthrough
- [ ] First 50 users onboarded

---

## 10. Open Questions

1. **Conflict tiebreaker default** — should there be an automatic tiebreaker
   model, or always defer to user? (Initial preference: user-controlled.)

2. **Architect memory format** — Markdown bible vs structured JSON?
   Markdown is human-readable; JSON is machine-queryable. Likely both:
   markdown for display, JSON for retrieval.

3. **V0 language coverage** — TypeScript/JavaScript only? Or include Python?
   (Initial preference: JS-only V0; simpler sandbox, larger vibe-coder
   audience.)

4. **Pricing model** — free during beta. Post-beta: BYOK + free? small
   subscription? still TBD.

5. **Telemetry** — opt-in metrics for debugging. Likely candidates: per-task
   latency, cost, conflict frequency. **Never** code or prompts.

6. **Naming** — `polycoder` is a working placeholder. Final name TBD.

---

## 11. Prior Art

- **MetaGPT** (2023) — multi-agent role-based coding agent. Uses single model
  in different roles. polycoder differs by using *real heterogeneous models*
  per role and targeting evolution rather than initial generation.
- **ChatDev** — sibling to MetaGPT; same single-model pattern.
- **Aider's `/architect` mode** — two-model split (architect + editor).
  polycoder generalizes this idea to 8 specialized roles.
- **Cursor / Cline / Aider / Continue.dev** — multi-model in the sense that
  *the user picks one model per query*. polycoder picks *per role*.
- **Lovable / Bolt / v0** — single-model black-box generation for vibe coders.
  polycoder is the antithesis: multi-model with selective transparency.
- **Multi-Agent Debate** literature (Du et al. 2023, ReConcile, Self-Refine) —
  research direction. Mostly turn-based debate; polycoder uses pipelined
  cognitive specialization, which is a different design point.

---

## 12. What This Document Is

A design contract written **before** code. The intent is for the data model
and role definitions to remain stable while implementation iterates.

**If something in this document turns out wrong during implementation, update
this document first, then write code.** Drift between the spec and the code
is the primary risk for a project of this size.

## 13. Companion Documents

- [`map.md`](./map.md) — Project navigation map. The first thing a
  new (or returning) contributor should read.

- [`todo.md`](./todo.md) — Phased build plan with concrete tasks
  through V1.0. The working backlog.

- [`docs/decisions.md`](./docs/decisions.md) — Architecture Decision
  Log. ADR-001 through ADR-006 cover the original design; ADR-007
  through ADR-012 cover decisions informed by reading Claude Code's
  source.

- [`docs/claude-code-learnings.md`](./docs/claude-code-learnings.md) —
  Distilled observations from reading Claude Code's source tree, with
  notes on what we adopt, adapt, or reject for polycoder.

- [`docs/prompts/`](./docs/prompts/) — V0.1 first-draft system prompts
  for all 8 roles, plus a shared preamble. See `docs/prompts/README.md`
  for the file index and assembly-time composition.

- [`docs/specs/`](./docs/specs/) — Implementation contracts for the
  three biggest layers:
  - [`providers.md`](./docs/specs/providers.md) — LLM provider
    abstraction + 5 V0 adapters
  - [`tools.md`](./docs/specs/tools.md) — Tool framework + 10 V0
    tools
  - [`orchestrator.md`](./docs/specs/orchestrator.md) — Pipeline
    state machine, conflict detection, retries, memory updates

## 14. Cross-cutting design principles (informed by Claude Code learnings)

The following principles are universal across roles and are reinforced
in each role's prompt template:

1. **Roles are role-bound, not freeform.** Each role has a strict
   tool allowlist and a strict input/output schema. (ADR-007, ADR-008)

2. **System prompts have a static cacheable prefix and a dynamic
   suffix**, separated by a literal `___POLYCODER_PROMPT_BOUNDARY___`
   marker. Per-iteration data goes in user messages, not system
   prompts. (ADR-009)

3. **Inter-role communication uses XML envelopes with JSON payloads**,
   modeled on Claude Code's `<task-notification>` pattern. (ADR-010)

4. **Verification independence is enforced**: Coder and Adversary must
   use different models. The orchestrator warns and labels iterations
   if violated. (ADR-011)

5. **Synthesis discipline**: roles must restate facts in their output,
   not delegate understanding ("based on the prior role's…" is
   forbidden). The Architect role enforces this most strictly. (ADR-012)

6. **Faithful reporting and anti-sycophancy are universal directives**
   that appear in every role's static preamble.

7. **Quantitative output budgets** per role (token/word counts), not
   qualitative ("be concise"). Each role's prompt header specifies its
   budget.

8. **Disagreement is first-class, not buried**. The Communicator's
   single most important responsibility is surfacing role-vs-role
   disagreements as user-facing decisions.
