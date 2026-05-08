# polycoder — Project Map

> **Read this first if you're new (or returning) to this project.**
> One-page overview of what's where, what depends on what, and how to
> navigate.

---

## 1. What polycoder is, in 60 seconds

A multi-model AI coding assistant for non-technical users ("vibe
coders"). Eight specialized roles (each backed by a user-chosen LLM)
collaborate through a fixed pipeline to produce code that survives the
**MVP→production gap** that single-model tools (Lovable, Bolt, v0,
Cursor) leave open.

Target market: Chinese-market vibe coders, where Western tools are
unavailable and domestic LLMs (DeepSeek, Qwen, GLM) are 10–50× cheaper
— making multi-model adversarial review economically viable for the
first time.

For the full design, see [`SPEC.md`](./SPEC.md).

---

## 2. The 8-role pipeline at a glance

```
                ┌──────────────┐
   user prompt →│  Translator  │ → structured spec
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │   Designer   │ → UI/UX plan
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │  Architect   │ ← project memory
                └──────┬───────┘   ↓
                       ▼           updates memory
                ┌──────────────┐
                │    Coder     │ → code diff
                └──────┬───────┘
                       ▼
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────────┐ ┌────────────┐
  │Adversary │  │Long-term Crit│ │Test Runner │
  └─────┬────┘  └──────┬───────┘ └─────┬──────┘
        └──────────────┼───────────────┘
                       ▼
                 conflict detection
                       ▼
                ┌──────────────┐
                │ Communicator │ → user-facing summary
                └──────────────┘   + disagreement cards
```

**Pipeline rules**:
- Roles 1-4 are sequential.
- Roles 5-7 (Adversary, Long-term Critic, Test Runner) run in parallel.
- Role 8 (Communicator) sees all upstream outputs and writes the only
  user-facing text.
- Coder's model **must** differ from Adversary's and Test Runner's
  (ADR-011). Orchestrator enforces.
- Each role has a strict tool allowlist — Adversary can read code but
  cannot edit it; Coder writes production code; Test Runner writes
  only test files.

For each role's prompt and contract, see [`docs/prompts/`](./docs/prompts/).

---

## 3. How a single iteration assembles a prompt

For each role call:

```
┌────────────────────────────────────────┐
│  STATIC PREFIX (cacheable)             │
│  - Shared preamble §1-3                │
│  - Role-specific §4-10                 │
└────────────────────────────────────────┘
        ↓
___POLYCODER_PROMPT_BOUNDARY___
        ↓
┌────────────────────────────────────────┐
│  DYNAMIC SUFFIX (per-iteration)        │
│  - Workspace name                      │
│  - Iteration number                    │
│  - Project memory snapshot             │
└────────────────────────────────────────┘
        ↓ + user message containing:
        ↓ - <role-input> XML envelope with
        ↓   prior-role outputs and task data

→ Model produces:
  <role-output role="..." iteration="..." model="...">
    <status>...</status>
    <summary>...</summary>
    <payload>{ ...JSON... }</payload>
  </role-output>
```

The static prefix is byte-stable across calls within a session, so
prompt caching kicks in when the same model serves multiple roles.
See ADR-009.

---

## 4. Document map (reading order for new contributors)

### A. The 30-minute orientation

```
1.  README.md                          ← what is this project, 60s
2.  map.md                             ← (this file) project navigation
3.  SPEC.md                            ← full design (the contract)
4.  todo.md                            ← what to build next
```

### B. The deeper-dive order

```
5.  docs/decisions.md                  ← ADRs explaining the why
6.  docs/claude-code-learnings.md      ← what we borrowed from Claude
                                         Code's source and why
7.  docs/prompts/README.md             ← prompt files index
8.  docs/prompts/00-shared-preamble.md ← universal directives every role gets
9.  docs/prompts/01-translator.md      ← first role; simplest example
                                         of the prompt template shape
10. docs/prompts/03-architect.md       ← most-pivotal role; read after
                                         01 to understand synthesis
                                         discipline (ADR-012)
11. docs/prompts/{04..08}.md           ← remaining roles in pipeline
                                         order
```

### C. Implementation contracts (read before writing code)

```
12. docs/specs/README.md               ← specs index
13. docs/specs/providers.md            ← LLM provider abstraction +
                                         5 adapters
14. docs/specs/tools.md                ← Tool framework + 10 V0 tools
15. docs/specs/orchestrator.md         ← Pipeline state machine,
                                         conflict detection, retries,
                                         memory updates
```

For experienced project members coming back after time away:
**`map.md` → `todo.md`**. That's enough for context.

---

## 5. Code map (forward-looking — packages we will create)

The implementation hasn't started yet. Once it does, the layout will
be:

```
polycoder/
├── electron/                          ← Electron main + preload
│   ├── main.ts                        ← app entry, window, IPC
│   ├── preload.ts                     ← secure API surface to renderer
│   └── secrets/                       ← OS keychain integration
│
├── src/                               ← React renderer (vite + tsx)
│   ├── components/
│   │   ├── settings/                  ← Secrets + Team Config tabs
│   │   ├── workspace/                 ← main chat-like UI
│   │   ├── transparency/              ← L1/L2 disclosure components
│   │   └── disagreement/              ← disagreement card UI
│   ├── stores/                        ← Zustand stores (UI state)
│   └── routes/                        ← (if multi-route)
│
├── core/                              ← orchestrator + role harness
│   ├── orchestrator/
│   │   ├── pipeline.ts                ← state machine
│   │   ├── conflictDetection.ts       ← cross-role conflict logic
│   │   ├── repromptLogic.ts           ← retry on schema violations
│   │   └── synthesisDiscipline.ts     ← regex anti-pattern checker
│   ├── roleHarness/
│   │   ├── promptAssembly.ts          ← static prefix + dynamic suffix
│   │   ├── envelopeParser.ts          ← XML envelope → object
│   │   ├── envelopeBuilder.ts         ← object → XML envelope
│   │   └── payloadValidator.ts        ← Zod-based schema validation
│   ├── roles/                         ← per-role definitions (loaded
│   │   ├── translator.ts              ← from docs/prompts/*.md at
│   │   ├── designer.ts                ← startup; one .ts per role
│   │   ├── architect.ts               ← exports RoleDefinition object)
│   │   ├── coder.ts
│   │   ├── adversary.ts
│   │   ├── longTermCritic.ts
│   │   ├── testRunner.ts
│   │   └── communicator.ts
│   └── types/                         ← shared TS types
│
├── providers/                         ← LLM provider adapters
│   ├── ModelProvider.ts               ← abstract interface
│   ├── DeepSeekProvider.ts
│   ├── QwenProvider.ts
│   ├── GLMProvider.ts
│   ├── OpenAICompatProvider.ts
│   └── registry.ts                    ← name→provider lookup
│
├── tools/                             ← in-pipeline tools
│   ├── ToolDef.ts                     ← interface + buildTool factory
│   ├── readFile.ts
│   ├── writeFile.ts
│   ├── editFile.ts
│   ├── bash.ts                        ← restricted (test commands only
│   │                                     for Test Runner role)
│   ├── readProjectMemory.ts
│   ├── updateProjectMemory.ts
│   ├── readHistory.ts
│   ├── askUserQuestion.ts
│   ├── readDesignTokens.ts
│   └── runTestSuite.ts
│
├── data/                              ← persistence
│   ├── schema.sql                     ← SQLite migrations
│   ├── workspace.ts                   ← workspace CRUD
│   ├── projectMemory.ts               ← memory CRUD
│   └── iterations.ts                  ← iteration history
│
├── docs/                              ← (already exists)
├── SPEC.md                            ← (already exists)
├── README.md                          ← (already exists)
├── map.md                             ← (this file)
└── todo.md                            ← (next file)
```

This layout is **planned**, not built. See [`todo.md`](./todo.md) for
the order tasks will be tackled in.

---

## 6. Glossary

Key terms used across the project. If a term appears in a doc and
isn't here, add it.

| Term | Meaning |
|------|---------|
| **Role** | One of 8 cognitive functions in the pipeline. Each has a fixed allowlist of tools and a fixed I/O schema. |
| **Worker** | Synonym for role, used in coordinator-pattern context. |
| **Coordinator** | The pipeline orchestrator. Dispatches roles, never does work. |
| **Iteration** | One full pass through the pipeline (user prompt → all 8 roles → user-facing summary). A workspace accumulates iterations over time. |
| **Workspace** | A user's project: secrets, role assignments, project memory, iteration history. |
| **Project memory** | Architect-maintained persistent state of project conventions, decisions, registered components, tech debt. Persists across iterations. |
| **Envelope** | XML wrapper around a role's output. Includes status, summary, payload, usage metadata. |
| **Payload** | JSON object inside an envelope. Schema-validated per role. |
| **Static prefix / Dynamic suffix** | The two halves of a role's system prompt, separated by `___POLYCODER_PROMPT_BOUNDARY___`. Static is cacheable; dynamic isn't. |
| **Disagreement card** | UI surface showing two roles' conflicting judgments, attributed to specific models. The product's signature feature. |
| **Selective transparency** | Three visibility tiers (L1 default, L2 expandable, L3 debug-only) that progressively expose the multi-role discussion. |
| **Vibe coder** | Non-technical person building apps via natural-language prompts. Primary user. |
| **BYOK** | Bring Your Own Key. Users supply their own API keys; polycoder doesn't proxy. |
| **Preset** | A pre-filled role-to-model mapping (`budget`, `china_pro`, `mixed`, `custom`). |
| **Secret-by-reference** | Data model where `RoleAssignment.secret_id` is a foreign key, not inlined credential. (ADR-004) |
| **Iteration Survival Test** | The benchmark that validates the MVP→production thesis: 10 iterations on 5 app templates, comparing polycoder against single-model tools. |

---

## 7. Where decisions live (quick reference)

| Question | Look here |
|----------|-----------|
| What's the high-level architecture? | [`SPEC.md`](./SPEC.md) |
| Why was choice X made? | [`docs/decisions.md`](./docs/decisions.md) |
| What did we learn from Claude Code? | [`docs/claude-code-learnings.md`](./docs/claude-code-learnings.md) |
| What does role X do exactly? | [`docs/prompts/`](./docs/prompts/)`{01..08}*.md` |
| What's the universal directive every role gets? | [`docs/prompts/00-shared-preamble.md`](./docs/prompts/00-shared-preamble.md) |
| How does the LLM provider layer work? | [`docs/specs/providers.md`](./docs/specs/providers.md) |
| What tools exist and which roles can use them? | [`docs/specs/tools.md`](./docs/specs/tools.md) |
| How does an iteration actually run? | [`docs/specs/orchestrator.md`](./docs/specs/orchestrator.md) |
| What needs to be built next? | [`todo.md`](./todo.md) |
| Why is this called `polycoder`? | [`docs/decisions.md` ADR-006](./docs/decisions.md) (placeholder, subject to rename) |

---

## 8. Status

- ✅ **Design phase complete.** SPEC, ADRs, learnings, prompt drafts.
- ⬜ **Implementation phase.** See [`todo.md`](./todo.md).
- Working name `polycoder` is provisional (ADR-006).
- No production code yet.
- GitHub repo: [`chriswu727/polycoder`](https://github.com/chriswu727/polycoder)

---

## 9. Conventions for contributors (current and future)

1. **Spec-first development.** If something in `SPEC.md` is wrong,
   update SPEC.md first, then write code.
2. **ADR every non-trivial decision.** New ADRs go in
   `docs/decisions.md` with the next sequential number.
3. **No emojis in production UI text.** Per user preference. Internal
   docs (this file, prompts) may use minimal status markers (✅ ⬜).
4. **Faithful reporting** is universal — applies to commits, PRs,
   conversation. See `docs/prompts/00-shared-preamble.md` §3 for full
   rules.
5. **Commits batch a full unit of work.** Don't commit half-work.
   Push at the end of a session, not mid-session. (User preference;
   see CLAUDE.md.)
6. **Use chriswu727 GitHub account, HTTPS push.** SSH key on this
   machine belongs to a different account. (User memory.)
7. **Architectural memory = `docs/`**. Anything that future agents/
   contributors need to know goes here, not in volatile chat history.
