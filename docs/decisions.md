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
