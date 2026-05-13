# polycoder

Multi-model AI coding agent for vibe coders. Eight specialized roles
— Translator, Designer, Architect, Coder, Adversary, Long-term
Critic, Test Runner, Communicator — each backed by a user-chosen
LLM, collaborate through a fixed pipeline. Built for the **MVP →
production evolution** problem that single-model tools (Lovable,
Bolt, v0, Cursor) leave open.

> Working name. Final name TBD.

## Status

🟢 **V0.3 in progress (2026-05-13)** — Quick Edit suite shipped on
top of V0.2. polycoder now has a Copilot/Cursor-baseline daily-
driver loop alongside the 8-role pipeline:

| Mode             | Cost / iter   | Latency  | Use it for                        |
| ---------------- | ------------- | -------- | --------------------------------- |
| **Quick Edit**   | ~$0.001-0.01  | 5-15s    | Targeted change, "fix this", riff |
| **Full pipeline**| ~$0.10-0.20   | 5-15 min | New feature, production-quality   |

Quick Edit features (Copilot/Cursor-baseline):
- **Single-Coder fast path** — bypasses the 8-role review.
- **Live tool-call stream** — "Reading src/auth.ts" appears in
  real-time, not 10s after the fact.
- **@file mentions** — pin context with `@src/auth.ts`; resolves
  workspace-relative paths, injects content up front.
- **Unified diff preview** — every changed file shows colored +/-
  inline, no need to leave the app.
- **Conversation continuation** — "Continue this thread" button
  on a completed Quick Edit feeds the prior turn's full context
  into the next call. Model knows what it just did.
- **One-click revert** — restores pre-edit content for every file
  the iteration touched; deletes files it created. No git dance.

Project-level (works for both modes):
- **`.polycoder/rules.md`** — workspace-level user instructions.
  Falls back to POLYCODER.md / AGENTS.md / CLAUDE.md if absent.

🟢 **V0.2 shipped (2026-05-13)** — V0.1 skeleton + IST benchmark +
V3 cosmic frontend. End-to-end verified against real DeepSeek + GLM
API keys; produces real code in a real workspace.

```
$ pnpm smoke --prompt 'create a one-page hello world html'
…
smoke: runIteration → completed in 308s
  iteration_id    = 83b63002-…
  traffic_light   = green
  total_cost_usd  = 0.1214
  files_changed   = 1
  cost_records    = 8
  role_outputs    = translator, designer, architect, coder,
                    adversary, long_term_critic, test_runner,
                    communicator
```

What V0.2 added on top of the V0.1 skeleton:

- **IST benchmark** (Iteration Survival Test): 5 app templates ×
  10 iterations, with metrics for complexity drift, coverage
  maintenance, model-attempt-rate, traffic-light progression.
  Findings in `docs/benchmark-results-v0.2.md`.
- **V3 cosmic frontend**: full CSS-property-driven design system
  (oklch palette, glass surfaces, drifting starfield) replacing
  the V0.1 Tailwind primitives. Light + dark themes, friendly cost
  format, per-role hue identity.
- **Workspace lifecycle**: rename, delete, multi-project switcher.
- **Live preview iframe**: an in-app preview server serves the
  workspace root and auto-reloads on iteration completion.
- **Native macOS app menu**: ⌘N new workspace, ⌘⇧N new prompt,
  ⌘⇧T toggle theme.
- **Security hardening**: renderer runs with `sandbox: true`,
  `contextIsolation: true`, `nodeIntegration: false`, and a
  CJS-bundled preload that exposes a typed `window.polycoder`
  surface via `contextBridge`.
- **One-command dev launch**: `pnpm app` auto-detects native ABI
  mismatch between Node tests and Electron runtime and rebuilds
  `better-sqlite3` + `keytar` only when switching.

## Quick start

```bash
git clone https://github.com/chriswu727/polycoder.git
cd polycoder
pnpm install         # native modules: better-sqlite3, keytar
pnpm app             # launches Electron + Vite, auto-rebuilds ABI
```

In the app:

1. Create a workspace (point it at a real, empty directory, or an
   existing project root if you want Quick Edit to operate on it).
2. **Settings → Secrets** → Add API keys (DeepSeek / Qwen / GLM /
   Anthropic / OpenAI-compat).
3. **Settings → Team** → Click **Quick Setup: Budget** (or
   China-Pro / Mixed), or assign each of the 8 roles manually.
4. **Workspace** → type a prompt → **Send**.
   - **Quick edit** (default) → single Coder model, 5-15s. Best
     for "fix the X in @path/to/file" requests.
   - **Full team** → all 8 roles, 5-15 min. Best for "build me a
     new feature" or production-quality work.
5. Watch tool calls stream in (Quick Edit) or the 8 role rows
   light up live (full pipeline).
6. Read the result + diff inline. Hit **Continue this thread** to
   refine without re-priming, or **Revert this edit** if it went
   wrong. The right pane shows a live preview iframe.

API keys are stored in your **OS keychain** (macOS Keychain Services,
Windows Credential Manager, Linux Secret Service). They never touch
the SQLite database, never leave your machine.

## Repo layout

```
polycoder/
├── core/                 ← role harness, orchestrator, types
├── data/                 ← SQLite schema + CRUD
├── electron/             ← main process, IPC, preload, preview server, OS keychain
├── providers/            ← LLM adapters (DeepSeek/Qwen/GLM/OpenAI/Anthropic)
├── tools/                ← 10 V0 tools (read/write/edit_file, bash, …)
├── benchmarks/ist/       ← IST benchmark: templates, runner, metrics, aggregator
├── src/                  ← React renderer (Vite)
│   ├── components/
│   │   ├── settings/     ← Secrets / Team / Preferences tabs
│   │   ├── workspace/    ← prompt panel + role-pipeline progress + result + preview
│   │   ├── shell/        ← sidebar + workspace switcher
│   │   └── icons.tsx     ← V3 cosmic glyph set (Mark, VerdictPlanet, role icons)
│   ├── stores/           ← Zustand: workspace + iteration + preferences
│   └── index.css         ← V3 cosmic design tokens
├── scripts/              ← smoke, ist-{run,metrics,aggregate}, dev-electron
└── docs/                 ← spec, ADRs, prompt templates, benchmark results
```

For a full navigation map start with [`map.md`](./map.md). For the
design contract see [`SPEC.md`](./SPEC.md). For the build plan and
remaining work see [`todo.md`](./todo.md).

## Tech stack

| Layer        | Choice                                              |
| ------------ | --------------------------------------------------- |
| Language     | TypeScript 5.7 (strict + exactOptionalPropertyTypes)|
| Renderer     | React 19 + Vite 7                                   |
| Design       | Custom CSS-property tokens (oklch); Geist + Geist Mono |
| State        | Zustand 5                                           |
| Validation   | Zod 4 (with `z.toJSONSchema`)                       |
| App shell    | Electron 34 (CJS preload, sandbox + isolation on)   |
| Data         | better-sqlite3 12 (sync)                            |
| Secrets      | keytar (OS keychain)                                |
| Test         | Vitest 2                                            |
| Package mgr  | pnpm 9                                              |

## Development workflow

```bash
# All-in-one quality gate (used by CI)
pnpm check            # lint + typecheck + test

# Single phase
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch       # vitest --watch

# Renderer only (browser, no Electron)
pnpm dev              # vite dev server at localhost:5173

# Full app (renderer + main + preload + auto ABI switch)
pnpm app              # recommended — wraps electron:dev

# Native-module dance, if you want to drive it manually
pnpm test:node-rebuild       # rebuild for Node (before pnpm test)
pnpm exec electron-rebuild -f -w better-sqlite3 -w keytar
                             # rebuild for Electron (before electron:dev)

# End-to-end smoke against real LLM APIs
POLYCODER_SMOKE_DEEPSEEK_KEY=sk-… \
POLYCODER_SMOKE_GLM_KEY=… \
pnpm smoke --prompt 'build a tiny todo app'

# IST benchmark (multi-iteration survival test)
pnpm ist-run            # run iterations against templates
pnpm ist-metrics        # compute per-run metrics
pnpm ist-aggregate      # roll up into charts + report

# Mac .app for personal use (no signing)
pnpm dist:dir           # → release/mac-{arm64,x64}/polycoder.app
pnpm dist:mac           # → release/polycoder-{version}.dmg
# dist:* leaves Electron-ABI binaries; restore for tests with:
pnpm test:node-rebuild
```

## Architecture in one paragraph

A user prompt enters via the renderer's prompt panel, which calls
`window.polycoder.iteration.start(...)` over IPC. The Electron main
process runs `runIteration`, which orchestrates the 8 roles through
`invokeRole` calls. Each role gets a system prompt assembled from
the shared preamble + role-specific markdown + a per-iteration
dynamic suffix, then talks to its assigned LLM (DeepSeek / Qwen /
GLM / Anthropic / OpenAI-compat) via a uniform `ModelProvider`
interface. The role's output is parsed from XML envelope → JSON
payload → Zod-validated. Architect-only synthesis-discipline regex
flags lazy delegation. After Coder runs, parallel reviewers
(Adversary / Long-term Critic / Test Runner) fan out via
`Promise.all`. A pure `detectConflicts` function scans cross-role
disagreements (5 rules). Communicator produces the final
user-facing prose plus disagreement cards. Architect's
`memory_updates` are applied to project memory **only on full
success**. Events stream from the orchestrator's `PipelineEventBus`
back to the renderer via `webContents.send`, where a Zustand
reducer drives the live role-progress UI. A separate single-tenant
HTTP server (`electron/preview/server.ts`) serves the workspace
root for the in-app preview iframe and rebinds on workspace switch
without restarting.

For the full design see [`SPEC.md`](./SPEC.md) +
[`docs/specs/{providers,tools,orchestrator}.md`](./docs/specs/).

## Why polycoder

- **Targets the MVP→production gap.** Lovable / Bolt / v0 / Cursor
  optimize for the first prompt's magic. Their apps reliably break
  by the 5th–7th iteration: no architectural memory, no enforced
  tests, no refactoring pressure. polycoder addresses this with
  multi-model collaboration (8 cognitive roles, each backed by a
  user-chosen model), persistent project memory, and selective
  transparency on cross-role disagreements.

- **Targets the Chinese market.** Lovable / Bolt / v0 / Cursor
  with Claude are unavailable or unreliable there. Domestic LLMs
  (DeepSeek, Qwen, GLM) are 10–50× cheaper than Western
  counterparts — making multi-model adversarial review economically
  viable for the first time.

- **BYOK + per-role model assignment.** Cursor locks you to Claude;
  v0 locks you to GPT. polycoder lets you bring any combination of
  API keys and assign each role its own (provider, model). One
  preset click for Budget / China-Pro / Mixed, or hand-configure
  every row.

## Roadmap

- **V0.1 ✅** — backend + Settings UI + chat workspace + end-to-end
  smoke against real APIs.
- **V0.2 ✅** — IST benchmark (5 app templates × 10 iterations);
  V3 cosmic frontend; workspace lifecycle (rename / delete /
  switcher); live preview iframe; macOS app menu; CJS preload +
  renderer sandbox.
- **V0.3 (in progress)** — Quick Edit suite (single-Coder fast
  path + live tool-call stream + @file mentions + diff preview +
  conversation continuation + one-click revert + `.polycoder/
  rules.md`). Brings the daily-driver loop to Copilot/Cursor
  baseline alongside the 8-role pipeline. Still TODO: code
  viewer / file tree, Cmd+K on selection, multi-iter resume for
  the full pipeline, L2 expandable team-discussion view, local
  WebContainer sandbox.
- **V0.4** — More providers (Doubao / Kimi / MiniMax), custom
  prompt overrides, project memory inspector, multi-iteration
  resume.
- **V1.0** — Mac DMG + Win installer with code signing, auto-update,
  in-app onboarding, public release.

See [`todo.md`](./todo.md) for the full task breakdown.

## Contributing

Spec-first development:

- If something in `SPEC.md` turns out wrong during implementation,
  update SPEC.md first, then the code.
- New non-trivial decisions get an ADR in `docs/decisions.md`.
- All commits go through `pnpm check` (lint + typecheck + test) +
  CI (`.github/workflows/ci.yml`).

## License

TBD (likely MIT or Apache-2.0).
