# polycoder — Build Plan

> **Read this with [`map.md`](./map.md) for context.**
> Tasks are ordered by phase. Within a phase, layer dependencies are
> noted. Check `[x]` when done; do not delete completed items —
> history is information.

---

## Status

- ✅ **Design phase complete.** All design and flow documents are
  drafted. SPEC, ADRs (1-13), 8 role prompts + shared preamble,
  3 implementation specs (providers / tools / orchestrator), this
  build plan, and the project map.
- 🟡 **Implementation phase: V0.1 Layers A-E complete.**
  - ✅ Layer A — Repo scaffolding (5/5)
  - ✅ Layer B — Data model + persistence (6/6)
  - ✅ Layer C — Provider abstraction (11/11)
  - ✅ Layer D — Secret manager (4/4)
  - ✅ Layer E — Tool framework + 10 V0 tools (15/15)
  - ⬜ Layers F-J pending. See per-layer task lists below.
- 🧪 **Test count**: 218 passing + 4 skipped (integration), 27 files.
- 🟢 **CI** green.

**Next concrete step**: Layer F.1 — Role definitions (one TS file
per role under `core/roles/`, loading the static prefix from
`docs/prompts/*.md`).

---

## Phase V0.1 — Skeleton

**Goal**: end-to-end working pipeline that produces a real app from a
real prompt, using all 8 roles, with the Settings UI to configure
secrets and role-model assignments. No benchmarks yet.

**Exit criteria**:
- User can launch the desktop app, add 1+ secrets, configure all 8
  roles, type a prompt, and watch the pipeline produce code.
- Pipeline runs to completion or surfaces a meaningful error.
- All 10 V0 tools work.
- Project memory persists across iterations.

### Layer A — Repo scaffolding (foundational, must be first)

- [x] **A.1** Initialize TypeScript monorepo structure:
      `package.json`, `tsconfig.json` (strict), `.eslintrc`,
      `.prettierrc`. Decided: **pnpm** (bun not installed; pnpm
      already present, mature Electron+React support, China-friendly
      mirrors). See ADR-013. Done 2026-05-08.
- [x] **A.2** Set up Vite + React + Tailwind + shadcn/ui scaffold
      under `src/`. Vite v8 + React 19 + Tailwind v4 + cn() helper
      installed. `pnpm build:renderer` produces 191KB JS / 6KB CSS.
      shadcn/ui components added on-demand (Layer H). Done 2026-05-08.
- [x] **A.3** Set up Electron main + preload under `electron/`.
      Electron 42, contextIsolation + sandbox enabled, preload
      exposes `window.polycoder` typed shim. `pnpm build:electron`
      produces `dist/electron/{main,preload}.js`. `pnpm electron:dev`
      runs Vite + Electron concurrently via `concurrently`+`wait-on`
      (runtime launch verified locally). Done 2026-05-08.
- [x] **A.4** Set up `pnpm test` config (vitest 2.1.9); sanity test
      in `core/types/sanity.test.ts` passes. GitHub Actions workflow
      `.github/workflows/ci.yml` runs lint + typecheck + test +
      builds (renderer + electron) on push/PR to main. `pnpm check`
      runs the full chain locally. Done 2026-05-08.
- [x] **A.5** Set up SQLite via better-sqlite3 (v12.9.0; sync API,
      works in Electron main). Smoke test in `data/sanity.test.ts`
      covers CREATE/INSERT/SELECT, WAL mode pragma, and FK
      constraint enforcement. 3 tests pass. Done 2026-05-08.

### Layer B — Data model + persistence

Reference: [`SPEC.md` §5](./SPEC.md#5-data-model)

- [x] **B.1** Define TypeScript types for `Workspace`, `Secret`,
      `RoleAssignment`, `ProjectMemory`, `IterationTrace`,
      `RoleOutput` envelope. Zod schemas in `core/types/{role,
      workspace, projectMemory, cost, iteration}.ts`. Per-role
      payload schemas remain `z.unknown()` for now — to be tightened
      in Layer F when the role harness validates them. 24 tests
      pass. Done 2026-05-08.
- [x] **B.2** SQLite schema migration v1: tables for `workspaces`,
      `secrets`, `role_assignments`, `iterations`, `project_memory`,
      `cost_records`, plus `schema_migrations` for version tracking.
      `data/schema.sql` + `data/connection.ts` (openDatabase /
      runMigrations / getCurrentSchemaVersion). WAL + foreign_keys
      ON. Project memory stored as single JSON blob per workspace
      (read pattern is always full snapshot). 7 connection tests
      pass including cascade-delete and idempotent migration.
      Done 2026-05-08.
- [x] **B.3** Workspace CRUD (`data/workspace.ts`). createWorkspace
      seeds 8 empty role assignments + empty project memory in one
      transaction. Secret CRUD (metadata only — keys stay in
      keychain). RoleAssignment update + ON DELETE SET NULL when a
      Secret is deleted. `getHydratedWorkspace` returns workspace +
      secrets + assignments in one fetch. 11 tests pass. Caught and
      fixed: `base_url` schema needed `.nullable()` not `.optional()`
      (SQLite returns null, Zod optional requires undefined).
      Done 2026-05-08.
- [x] **B.4** Project memory CRUD (`data/projectMemory.ts`).
      `applyMemoryUpdate` is transactional — partial updates roll
      back on error (verified by test). Supports add_decisions,
      add_conventions, add_components, add_tech_debt,
      supersede_decisions (auto-links old↔new via supersedes/
      superseded_by), set_design_tokens. `markTechDebtResolved` for
      flipping resolved flag with iteration number. 10 tests pass.
      Done 2026-05-08.
- [x] **B.5** Iteration history CRUD (`data/iterations.ts`).
      `startIteration` auto-increments iteration_number per workspace
      (independent sequences per workspace verified). `finishIteration`
      computes duration_ms server-side, persists role_outputs and
      conflicts as JSON. `listIterations` paginates newest-first.
      10 tests pass. Done 2026-05-08.
- [x] **B.6** Cost records CRUD (`data/costRecords.ts`).
      `appendCostRecord` writes one row per role invocation;
      `totalsByIteration` / `totalsByWorkspace` / `totalsByModel` /
      `totalsByRole` aggregate via SQL SUM. Cascade delete from
      iterations verified. 7 tests pass. Done 2026-05-08.

### Layer C — Provider abstraction

Reference: [`docs/specs/providers.md`](./docs/specs/providers.md)

- [x] **C.1** Define `ModelProvider` interface + types
      (`providers/ModelProvider.ts`). Includes ChatRequest /
      ChatResponse / StreamEvent / ToolSchema / TestConnectionResult
      / ModelInfo. Done 2026-05-08.
- [x] **C.2** Define `ProviderError` taxonomy
      (`providers/errors.ts`). + `classifyHttpStatus` helper. Plus
      `httpClient.ts` (fetch wrapper with composable abort + timeout)
      and `sseParser.ts` (SSE parser handling OpenAI + Anthropic
      formats, multi-chunk reads, comments, multi-line data).
      14 tests pass. Done 2026-05-08.
- [x] **C.3** Implement `OpenAICompatProvider`
      (`providers/OpenAICompatProvider.ts`). Full chat (non-stream)
      + stream paths. Tool-call argument assembly across deltas
      (handles `index` field and incremental JSON args). Cost
      computation with cached-token tier. fetchImpl injection for
      tests. 10 tests pass. Done 2026-05-08.
- [x] **C.4** Implement `DeepSeekProvider`. Hardcoded catalog
      (deepseek-chat, deepseek-coder, deepseek-reasoner) with cached-
      input pricing. listModels returns catalog directly (no
      /v1/models call). Done 2026-05-08.
- [x] **C.5** Implement `QwenProvider`. DashScope `compatible-mode`
      endpoint. enable_search:false injected into every request body
      (verified by test). Catalog includes Qwen-VL-Max for vision.
      Done 2026-05-08.
- [x] **C.6** Implement `GLMProvider`. open.bigmodel.cn base URL.
      Catalog includes glm-4-flash with 0 cost (free tier eligible).
      Free-tier rate-limit handling deferred to runtime backoff
      (handled by general 429 retry). Done 2026-05-08.
- [x] **C.7** Implement `AnthropicProvider` (native /v1/messages).
      Separate path: system prompt extracted to top-level field;
      x-api-key + anthropic-version headers (not Authorization
      Bearer); tool schema as `{ name, description, input_schema }`;
      tool message → user-role with tool_result content block;
      stream parses event:type SSE format with content_block_start /
      delta / stop events; cache_read + cache_creation tokens
      summed into cached_input_tokens. 7 tests pass. Done 2026-05-08.
- [x] **C.8** `prepareSystemPrompt` shared helper. `prepareForOpenAICompat`
      strips marker; `prepareForAnthropic` splits into 2 blocks with
      cache_control:ephemeral on the first. Handles edge cases (no
      marker → single block; empty half → elided). 5 tests pass.
      Done 2026-05-08.
- [x] **C.9** Provider registry (`providers/registry.ts`).
      `buildProvider(secret, opts)` dispatches on `secret.provider`,
      threads optional `fetchImpl` through, requires `base_url` for
      openai-compat. Exhaustiveness check via `never` for unknown
      provider id. 7 tests pass. Done 2026-05-08.
- [x] **C.10** Unit tests for each adapter — shipped alongside each
      adapter implementation:
      `OpenAICompatProvider.test.ts` (10), `domesticAdapters.test.ts`
      (8), `AnthropicProvider.test.ts` (7), `errors.test.ts` (7),
      `sseParser.test.ts` (7), `prepareSystemPrompt.test.ts` (5),
      `registry.test.ts` (7). Done 2026-05-08.
- [x] **C.11** Integration test scaffold (`providers/integration.test.ts`).
      Gated by `POLYCODER_INT_TEST_{DEEPSEEK,QWEN,GLM,ANTHROPIC}_KEY`
      env vars via `describe.runIf`. 4 skip-by-default suites. CI
      never runs them. Done 2026-05-08.

### Layer D — Secret manager

Reference: [`SPEC.md` §8](./SPEC.md#8-storage--security)

- [x] **D.1** OS keychain abstraction
      (`electron/secrets/keystore.ts`). KeyStore interface +
      OsKeystore (keytar 7.9.0, cross-platform: macOS Keychain,
      Win Credential Manager, Linux Secret Service) +
      InMemoryKeystore (test seam). Service name `polycoder`,
      account = `${workspace_id}:${secret_id}`. accountFor/parseAccount
      helpers for cleanup workflows. 6 contract tests pass.
      Done 2026-05-08.
- [x] **D.2** Secret CRUD on top of keystore (`data/secrets.ts`).
      `addSecret` writes metadata + key together; rolls back metadata
      if keystore write fails (verified by test). `getHydratedSecret`
      returns metadata + plaintext for provider construction;
      `removeSecret` is idempotent across both stores;
      `pruneOrphanedKeys` cleans keystore entries whose metadata is
      gone. Plaintext key NEVER persisted to SQLite. 10 tests pass.
      Done 2026-05-08.
- [x] **D.3** `testSecret(db, keystore, input, opts)` in
      `data/secretsTest.ts`. Hydrates secret → builds provider via
      registry → calls `provider.testConnection()` → on success,
      persists `available_models` + `last_tested_at` to metadata.
      On failure, metadata untouched. fetchImpl injection for tests.
      3 tests pass (success / auth-fail / missing). Done 2026-05-08.
- [x] **D.4** IPC bridge for secret CRUD.
      `electron/ipc/channels.ts` (single source of truth for channel
      names) + `electron/ipc/secretsHandlers.ts` (pure handler fns:
      handleAddSecret / handleListSecrets / handleRemoveSecret /
      handleTestSecret — testable without Electron).
      `electron/preload.ts` exposes typed `window.polycoder.secrets`
      API. `electron/main.ts` opens DB at `userData/polycoder.db`,
      instantiates `OsKeystore`, registers handlers via
      `ipcMain.handle`. Verified `pnpm build:electron` emits all
      .js to `dist/electron/`. 4 handler tests pass (including
      verification that plaintext key never appears in any
      response). Done 2026-05-08.

### Layer E — Tool framework + V0 tools

Reference: [`docs/specs/tools.md`](./docs/specs/tools.md)

- [x] **E.1** `ToolDef` interface + `buildTool` factory
      (`tools/ToolDef.ts`). Includes ToolName registry, ToolContext
      with read_files_in_iteration tracking (for read-before-edit),
      ToolError taxonomy with 9 codes, BuiltTool type. 4 tests pass.
      Done 2026-05-08.
- [x] **E.2** Workspace path validation helpers
      (`tools/workspaceBoundary.ts`). resolveInWorkspace handles
      relative + absolute paths, ../ escape, symlink escape (via
      realpath), and non-existent paths (for write tools).
      displayPath for error messages. 9 tests pass. Done 2026-05-08.
- [x] **E.3** `read_file` (`tools/readFile.ts`). Workspace boundary
      check, line-range slicing (1-based), 10MB cap, line-number
      prefix, records reads in ctx.read_files_in_iteration. 5 tests.
      Done 2026-05-08.
- [x] **E.4** `write_file` (`tools/writeFile.ts`). Refuses overwrite,
      auto-creates parent dirs, 1MB cap, Test Runner restricted to
      *.test.* / *.spec.* / **/test/** / **/__tests__/**. 5 tests.
      Done 2026-05-08.
- [x] **E.5** `edit_file` (`tools/editFile.ts`). Read-before-edit
      enforced, unique-old_string check (or replace_all), no-op
      detection, atomic write via temp+rename, unified diff.
      6 tests. Done 2026-05-08.
- [x] **E.6** `read_project_memory`. All-section default, optional
      single-section selector. Read-only, all roles. 2 tests.
      Done 2026-05-08.
- [x] **E.7** `update_project_memory`. Architect-only. Wraps
      data-layer applyMemoryUpdate (transactional). Uses
      ctx.iteration_number as default. 2 tests. Done 2026-05-08.
- [x] **E.8** `read_history`. Long-term Critic + Architect only.
      Pagination (last_n ≤ 50). Extracts intent_summary, coder_status,
      test_runner_status, files_changed from stored envelopes;
      include_full_envelopes flag for deep dives. 3 tests.
      Done 2026-05-08.
- [x] **E.9** `bash` (`tools/bash.ts`). Test Runner-only.
      SAFE_COMMAND_PATTERNS allowlist. cwd-within-workspace check.
      50KB output cap per stream. Timeout via SIGTERM→SIGKILL, abort
      signal honored. 6 tests. Done 2026-05-08.
- [x] **E.10** `run_test_suite` (`tools/runTestSuite.ts`). Detects
      framework via package.json + config files (vitest, jest, pytest,
      go-test, bun-test). Parses pass/fail/skip counts. 8 tests.
      Done 2026-05-08.
- [x] **E.11** `ask_user_question` (`tools/askUserQuestion.ts`).
      V0.1 STUB: throws ToolError(permission_denied) directing
      Translator to use default_assumption fallback. Schema fully
      defined for role-harness validation. Real IPC + UI path lands
      in Layer H. Done 2026-05-08.
- [x] **E.12** `read_design_tokens`. Designer-only. Wraps memory
      lookup; returns the design_tokens sub-tree (null fields on
      iteration 1 = signal to establish). 2 tests.
      Done 2026-05-08.
- [x] **E.13** Tool registry (`tools/registry.ts`). ALL_TOOLS map +
      DEFAULT_ROLE_ALLOWLISTS for all 8 roles + `toolsForRole(role)`
      that intersects role allowlist with per-tool allowedRoles
      (defense in depth). 11 tests pass. Done 2026-05-08.
- [x] **E.14** Zod-to-JSON-Schema helper (`tools/toJsonSchema.ts`).
      Uses Zod v4's native `z.toJSONSchema()` (not the v3 third-party
      package). Produces provider-neutral ToolSchema shape; adapters
      translate to OpenAI/Anthropic native. 2 tests pass. Done
      2026-05-08.
- [x] **E.15** Unit tests for each tool — co-located with each
      source file: ToolDef.test.ts (4), workspaceBoundary.test.ts (9),
      toJsonSchema.test.ts (2), fileTools.test.ts (16),
      memoryTools.test.ts (9), execTools.test.ts (14),
      registry.test.ts (11). Total: 65 new Layer E tests.
      Done 2026-05-08.

### Layer F — Role harness

Reference: [`docs/specs/orchestrator.md`](./docs/specs/orchestrator.md) §3

- [ ] **F.1** Role definitions (one TS file per role under
      `core/roles/`). Each loads the static prefix from
      `docs/prompts/*.md` at startup.
- [ ] **F.2** `assembleSystemPrompt` (`core/roleHarness/promptAssembly.ts`).
      Concatenates shared preamble + role static prefix + boundary
      marker + dynamic suffix.
- [ ] **F.3** XML envelope builder (`core/roleHarness/envelopeBuilder.ts`).
      Constructs `<role-input>` from upstream outputs.
- [ ] **F.4** XML envelope parser (`core/roleHarness/envelopeParser.ts`).
      Parses `<role-output>` → typed object. Robust against minor
      whitespace / formatting issues; rejects malformed input
      cleanly.
- [ ] **F.5** Payload validator (`core/roleHarness/payloadValidator.ts`).
      Zod-based; per-role outputSchema.
- [ ] **F.6** `runWithTools` inner loop
      (`core/roleHarness/runWithTools.ts`). Provider call → tool use
      → tool execution → tool result → repeat.
- [ ] **F.7** `invokeRole` with retry/re-prompt
      (`core/roleHarness/invokeRole.ts`). Includes the 6 re-prompt
      cases per orchestrator spec §6.
- [ ] **F.8** Unit tests for envelope parser (good + malformed
      inputs).
- [ ] **F.9** Unit tests for payload validators per role.

### Layer G — Pipeline orchestrator

Reference: [`docs/specs/orchestrator.md`](./docs/specs/orchestrator.md)

- [ ] **G.1** Pipeline event bus (`core/orchestrator/events.ts`).
- [ ] **G.2** `runParallelReviewers`
      (`core/orchestrator/parallelReviewers.ts`).
- [ ] **G.3** `detectConflicts` pure function
      (`core/orchestrator/conflictDetection.ts`).
- [ ] **G.4** `detectSynthesisDiscipline` regex check
      (`core/orchestrator/synthesisDiscipline.ts`). Architect-only.
- [ ] **G.5** `applyMemoryUpdates`
      (`core/orchestrator/applyMemoryUpdates.ts`). Runs after
      successful pipeline.
- [ ] **G.6** `runIteration` top-level
      (`core/orchestrator/runIteration.ts`). The state machine
      orchestrating sequential → parallel → sequential phases.
- [ ] **G.7** Cost tracker (`core/orchestrator/costTracker.ts`).
- [ ] **G.8** Iteration trace persistence
      (`core/orchestrator/iterationTrace.ts`).
- [ ] **G.9** Pipeline error taxonomy
      (`core/orchestrator/PipelineError.ts`).
- [ ] **G.10** Abort handling (`core/orchestrator/abort.ts`).
- [ ] **G.11** Unit tests: detectConflicts (table-driven; many
      conflict-rule cases).
- [ ] **G.12** Unit tests: detectSynthesisDiscipline (good + bad
      strings).
- [ ] **G.13** Integration test: end-to-end happy path with mocked
      providers ("build me a todo app" → produces files).

### Layer H — Settings UI

Reference: [`SPEC.md` §6.1, §6.2](./SPEC.md#6-ui-surfaces)

- [ ] **H.1** Workspace state (Zustand store) for the renderer.
- [ ] **H.2** IPC commands: `workspace.create`, `workspace.list`,
      `workspace.load`.
- [ ] **H.3** Secrets tab UI (`src/components/settings/SecretsTab.tsx`):
      list, add, edit, delete, test-connection.
- [ ] **H.4** Team Configuration tab UI
      (`src/components/settings/TeamConfigTab.tsx`): table with one
      row per role, dropdowns for credential and model.
- [ ] **H.5** Preset application logic + UI button.
- [ ] **H.6** Verification independence warning UI
      (per ADR-011: red banner when Coder model = Adversary model
      or Coder model = Test Runner model).

### Layer I — Workspace UI (main view)

Reference: [`SPEC.md` §6.3](./SPEC.md#6-ui-surfaces)

- [ ] **I.1** Chat-like main view layout.
- [ ] **I.2** Prompt input component.
- [ ] **I.3** Iteration display: traffic light, summary, what-changed
      list.
- [ ] **I.4** L1 transparency: model badges per role, cost summary,
      duration.
- [ ] **I.5** Disagreement card component
      (`src/components/transparency/DisagreementCard.tsx`).
- [ ] **I.6** What-to-do-next checklist component.
- [ ] **I.7** File diff viewer (for showing what Coder changed).
- [ ] **I.8** Live progress display during pipeline run (per-role
      streaming status: idle → in-progress → done).

### Layer J — End-to-end + packaging

- [ ] **J.1** End-to-end smoke test: real keys (DeepSeek + GLM
      free), real prompt ("build a todo app with localStorage"),
      verify produced files actually run (Vite + React + bun dev).
- [ ] **J.2** Mac DMG dev build (no signing yet).
- [ ] **J.3** Documentation: install instructions in README.
- [ ] **J.4** v0.1 git tag + GitHub release notes.

---

## Phase V0.2 — Validation

**Goal**: prove the MVP→production thesis with a benchmark.

**Preconditions**: V0.1 exit criteria met. Working pipeline.

- [ ] **V0.2.1** Iteration Survival Test (IST) benchmark design
      doc (`docs/specs/iteration-survival-test.md`). Specifies:
      app templates, iteration prompts per template, metrics, scoring.
- [ ] **V0.2.2** 5 app templates spec:
      - Todo app
      - E-commerce: simple product catalog + cart
      - Dashboard: 3-chart admin dashboard
      - Chatbot UI (frontend only, mock backend)
      - SaaS landing page
- [ ] **V0.2.3** 10 iteration prompts per template (50 total). Each
      iteration adds ~1 feature.
- [ ] **V0.2.4** IST runner: polycoder side. Loops through 50 iters,
      records metrics.
- [ ] **V0.2.5** IST runner: Lovable baseline (manual or scripted).
- [ ] **V0.2.6** IST runner: Bolt baseline.
- [ ] **V0.2.7** IST runner: single-Claude-via-Cursor baseline.
- [ ] **V0.2.8** Metrics computation (`core/metrics/`):
      - Test coverage maintenance rate (%)
      - Cyclomatic complexity growth (per-file, per-iteration)
      - Break frequency (iterations where the app didn't run)
      - Time-to-recovery from a break
- [ ] **V0.2.9** Metrics dashboard UI in workspace (V0.2 only — for
      developer use; V1.0 hides behind a feature flag).
- [ ] **V0.2.10** L2 transparency: expandable team-discussion view
      with per-role I/O traces.
- [ ] **V0.2.11** Salience scoring for memory updates (which
      decisions/lessons should the Architect promote to "important"?)
- [ ] **V0.2.12** Write up benchmark results in
      `docs/benchmark-results-v0.2.md`. THIS IS THE PROJECT'S CORE
      ARTIFACT.
- [ ] **V0.2.13** v0.2 git tag.

---

## Phase V0.3 — Local sandbox

**Goal**: user can run the polycoder-produced app without leaving
the polycoder window.

**Preconditions**: V0.2 complete (we have validation that the
pipeline works).

- [ ] **V0.3.1** Decision: WebContainer (StackBlitz) vs e2b vs
      native Docker. ADR-013. Recommend WebContainer for V0 (browser
      embedded, free, JS-only is fine for our target).
- [ ] **V0.3.2** Sandbox integration layer
      (`core/sandbox/`).
- [ ] **V0.3.3** "Open in localhost" button in workspace UI.
- [ ] **V0.3.4** File watcher / hot reload bridge (sandbox sees
      Coder's changes immediately).
- [ ] **V0.3.5** Browser preview pane in workspace UI.
- [ ] **V0.3.6** Console output forwarding (sandbox stdout → UI).
- [ ] **V0.3.7** v0.3 git tag.

---

## Phase V0.4 — Polish

**Goal**: ready to put in front of friends-and-family beta users.

- [ ] **V0.4.1** L3 transparency: debug mode toggle, full prompt
      templates and model parameters visible.
- [ ] **V0.4.2** Custom prompt override UI: per-role textarea that
      replaces the default prompt for that role in this workspace.
- [ ] **V0.4.3** Doubao provider adapter (`providers/DoubaoProvider.ts`).
- [ ] **V0.4.4** Kimi provider adapter (`providers/KimiProvider.ts`).
- [ ] **V0.4.5** MiniMax provider adapter
      (`providers/MiniMaxProvider.ts`).
- [ ] **V0.4.6** Project memory inspector UI (read-only view of all
      memory contents).
- [ ] **V0.4.7** Project memory editor UI (user can manually edit /
      delete memory entries — power user feature).
- [ ] **V0.4.8** Iteration history view (workspace-level: all past
      iterations with their traffic lights, costs, durations).
- [ ] **V0.4.9** Cost analytics view: per-workspace lifetime spend,
      breakdown by provider/model.
- [ ] **V0.4.10** Onboarding tutorial: first-run wizard that walks
      through adding a Secret and configuring roles.
- [ ] **V0.4.11** Settings: workspace export/import (JSON, with
      keys redacted — keys remain in keychain).
- [ ] **V0.4.12** Settings: workspace deletion + cleanup of secrets
      that aren't used elsewhere.
- [ ] **V0.4.13** Polish pass on all UI: spacing, typography,
      accessibility (keyboard nav, ARIA).
- [ ] **V0.4.14** v0.4 git tag.

---

## Phase V1.0 — Public release

**Goal**: shippable to anyone.

- [ ] **V1.0.1** Mac DMG production build with code signing
      (Apple Developer account required).
- [ ] **V1.0.2** Mac auto-update via Squirrel.Mac.
- [ ] **V1.0.3** Windows installer (NSIS or Squirrel.Windows).
- [ ] **V1.0.4** Windows auto-update.
- [ ] **V1.0.5** First-run flow: license/terms acknowledgement,
      privacy notice (we collect zero telemetry by default).
- [ ] **V1.0.6** In-app tutorial walkthrough (refined version of
      V0.4.10 onboarding).
- [ ] **V1.0.7** Marketing site (single-page, hosted on Cloudflare
      Pages or similar). Domain TBD.
- [ ] **V1.0.8** Demo video (~3 min, Chinese subtitles).
- [ ] **V1.0.9** Distribution plan:
      - Hacker News post (timed to product completeness)
      - 小红书 介绍 + tutorial
      - V2EX
      - 即刻
      - B站 demo video
- [ ] **V1.0.10** Initial 50-user beta plan: invite list, feedback
      channel (Discord? GitHub Discussions? feishu group?).
- [ ] **V1.0.11** Telemetry decision: opt-in only; if implemented,
      what's collected (per `docs/specs/orchestrator.md` §15-Q5).
- [ ] **V1.0.12** v1.0 git tag + GitHub release.

---

## Cross-cutting tasks (bug fixes, refactors as needed)

These appear during implementation as issues; not pre-planned.

- [ ] (Empty — populated by future iterations.)

---

## Open questions blocking work

These need resolution before the dependent task can start. As of
2026-05-08:

1. **Final project name** (ADR-006 marks `polycoder` as provisional).
   Decision deferred to V0.2 — doesn't block V0.1 work.

2. **bun vs pnpm** (Task A.1). Recommend bun. **Not blocking** — pick
   when starting A.1.

3. **WebContainer vs e2b vs Docker** for V0.3 sandbox (Task V0.3.1).
   Not blocking V0.1 or V0.2.

4. **Telemetry policy** (Task V1.0.11). Not blocking earlier work.

5. **License** (currently TBD). MIT or Apache-2.0 most likely.
   Pick before V1.0.

6. **Naming for the disagreement card UX** — call it "disagreement
   card", "team disagreement", "second opinion", or something more
   marketable? Not blocking implementation; UI text decision can
   be deferred.

---

## Parking lot (V1.1+ ideas)

Things that have been mentioned but explicitly deferred past V1.0:

- **Cloud / web version** (multi-device, team workspaces) — V2.x
- **Plugin system for custom roles** (à la Claude Code's
  `loadAgentsDir` pattern) — V2.x
- **Skills system** for domain-specific role extensions — V2.x
- **Multi-language UI** (English first, Chinese current default; add
  Japanese, Korean post-launch) — V1.1
- **Voice input** — V1.1
- **Fine-tuned small models** for narrow roles (e.g., a custom
  Adversary fine-tuned on real bug datasets) — research project,
  unscheduled
- **Marketplace** for shared role configurations / presets — V2.x
- **Direct deploy** (push polycoder-produced apps to Vercel/Netlify
  with one click) — V1.x

---

## How to use this file

- **Picking up work**: scan for the first unchecked `[ ]` in the
  current phase. Layers within a phase are mostly sequential
  (Layer A before B before C…), but tasks within a layer can often
  parallelize.
- **Marking done**: change `[ ]` to `[x]`. Don't delete completed
  items.
- **Adding a task**: append to the relevant layer/phase. Keep IDs
  stable (e.g. don't renumber when inserting).
- **Adding a phase**: rare — these correspond to product milestones.
  Discuss before adding.
- **Bumping a task across phases**: if V0.1 task gets too big,
  split it; don't move it forward unless it's truly out of scope.
  V0.1 is meant to be the substantial foundational lift.

---

## Estimates (rough)

Per layer, in raw LOC of source code (not counting tests):

| Layer | Approx LOC |
|-------|------------|
| A. Repo scaffolding | 200 (mostly config) |
| B. Data model + persistence | 800 |
| C. Provider abstraction | 1500 |
| D. Secret manager | 400 |
| E. Tool framework + 10 tools | 1500 |
| F. Role harness | 1200 |
| G. Pipeline orchestrator | 2000 |
| H. Settings UI | 1000 |
| I. Workspace UI | 1500 |
| J. End-to-end + packaging | 200 |
| **V0.1 total** | **~10300 LOC source + ~7000 LOC tests** |

V0.2-V1.0 add an estimated 5000-8000 LOC on top.

These estimates are rough. The point isn't precision — it's that the
project is **non-trivial** and the design-first investment is
justified.
