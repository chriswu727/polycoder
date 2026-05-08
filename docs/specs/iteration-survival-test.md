# Iteration Survival Test (IST)

V0.2 benchmark spec. Defines what we measure, why, how, and with
what scope. The goal of V0.2 is to produce
[`docs/benchmark-results-v0.2.md`](../benchmark-results-v0.2.md) —
the project's core defensible artifact: an honest, reproducible
comparison that supports or refutes polycoder's central thesis.

> **Status**: design (V0.2.1 of [`todo.md`](../../todo.md)).
> Implementation tasks V0.2.2 onward depend on this doc being
> approved.

---

## 1. Thesis under test

> **H1**: Single-model AI coding tools (Lovable, Bolt, Cursor with
> a single model) degrade in code quality with iteration count;
> multi-role multi-model orchestration maintains quality longer
> on the same prompt sequence.

Concretely, single-model tools tend to:

- forget architectural decisions made in earlier iterations
- skip writing or maintaining tests
- accumulate complexity without refactoring
- introduce regressions that break previously-working features

polycoder's claim is that an explicit Architect / Test Runner /
Long-term Critic / Adversary stack mitigates each of these failure
modes — and the IST is the experiment to demonstrate it.

---

## 2. Scope at a glance

```
3 app templates  ×  5 iterations  ×  3 systems  =  45 iterations
```

| Template | Iterations | What it stresses |
|----------|------------|------------------|
| Todo app | 5 | State, persistence, CRUD evolution |
| Dashboard | 5 | Multiple components, layout, data viz |
| Landing page | 5 | Markup-heavy; exercises Designer role |

| System under test | Why included |
|-------------------|--------------|
| **polycoder-full** (8 roles, China-Pro preset: GLM-4.5 for Architect/Adversary, DeepSeek-V3 elsewhere) | The system on trial |
| **polycoder-coder-only** (only Coder role enabled, same model as polycoder-full's Coder) | Cleanest internal control: same model, different orchestration. Isolates the multi-role contribution from model quality. |
| **Lovable** (free tier, latest GPT-class model as of 2026-05) | The most direct external competitor; closest UX overlap (chat-driven, end-user app output) |

This is **smaller** than the original V0.2 plan in `todo.md`
(5 templates × 10 iter × 4 systems = 200 iterations). See §10
"Scope cuts and why" for the reasoning.

---

## 3. Templates

Each template is identified by a code: `todo`, `dashboard`,
`landing`. The seed prompt for iteration 1 is checked into
`benchmarks/ist/prompts/<code>-iter01.md`. Iteration prompts 2-5
are also pre-committed (see §4).

All apps target plain HTML + JS + CSS (no framework lock-in) so
that build / smoke automation is uniform across systems. Lovable
is allowed to use whatever stack it prefers; we measure on the
**built artifact**, not the source.

### 3.1 Todo (`todo`)

A single-page todo list app. Local-storage persistence. The
sequence stresses CRUD evolution and state model continuity.

### 3.2 Dashboard (`dashboard`)

A read-only sales dashboard. Mock data hard-coded in JS. The
sequence stresses layout composition and the Designer role's
ability to maintain visual consistency across additions.

### 3.3 Landing (`landing`)

A marketing landing page for a fictional SaaS product. The
sequence stresses content blocking, typography, and design
consistency across sections.

---

## 4. Iteration prompts

All 15 prompts are committed to
`benchmarks/ist/prompts/<code>-iter<NN>.md` **before** any IST run
begins. Once committed, prompts cannot be edited mid-experiment
(see §8 reproducibility).

### 4.1 Todo iterations

1. Build a basic todo app: add items, mark items as done, delete
   items. Persist to localStorage. Single page, no framework.
2. Add categories (`Work`, `Personal`, `Other`) on each item, plus
   a category filter bar above the list.
3. Add a due date to each item. Add a sort toggle: "by added" /
   "by due date".
4. Allow nested subtasks under each todo item (one level deep).
   Parent's checkbox is checked iff all children are done.
5. Add multi-select with checkboxes per row, plus a bulk action
   bar that appears on selection: `Mark done`, `Delete`,
   `Move to category…`.

### 4.2 Dashboard iterations

1. Build a sales dashboard with three KPI cards (Today / This Week
   / This Month) showing revenue and orders. Use hardcoded mock
   data.
2. Add a line chart below the cards: revenue over the last 30 days.
3. Add a "Top Products" leaderboard table next to the chart with
   product name, units sold, revenue.
4. Add a filter bar at the top: date range presets (7 / 30 / 90
   days), and a region dropdown that filters all components.
5. Add a comparison toggle: when on, every metric shows a
   delta vs the previous equivalent period (last 30 days vs prior
   30 days).

### 4.3 Landing iterations

1. Build a SaaS landing page for a fictional product called
   "Polycoder". Sections: navbar, hero with CTA button, features
   grid (3 cards), footer.
2. Add a testimonials section between features and footer: 3
   cards with avatar placeholder, name, role, quote.
3. Add a pricing section with 3 tiers (Starter / Pro / Team), each
   showing price, 4 bullet features, CTA.
4. Add a FAQ section with at least 5 questions, each expandable
   (accordion).
5. Add a "Request a demo" form section: name, email, company,
   message. Client-side validation (required fields, email format)
   and a success state.

---

## 5. Systems under test

### 5.1 polycoder-full

- **Build**: tag `v0.1.0` (this release).
- **Team**: China-Pro preset.
  - Translator / Designer / Coder / Test Runner / Communicator:
    DeepSeek-V3 (`deepseek-chat`)
  - Architect / Adversary / Long-term Critic: GLM-4.5
    (`glm-4.5`)
- **Settings**: defaults except `MAX_TOOL_CALLS_PER_ROLE=40` (the
  V0.1 production value).
- **Workspace**: a fresh empty directory per template. Iteration 1
  starts cold. Iterations 2-5 carry workspace state forward.

### 5.2 polycoder-coder-only

A control variant: same `v0.1.0` build, but only the Coder role
runs. Concretely we use a one-off harness in
`benchmarks/ist/runners/coderOnly.ts` that:

- Calls Coder with the user prompt directly (skipping the
  Translator/Designer/Architect chain).
- Skips Adversary / Long-term Critic / Test Runner / Communicator.
- Persists the same workspace as polycoder-full.

This isolates the multi-role contribution. The model is identical
(DeepSeek-V3) so any quality delta cannot be explained by model
choice.

### 5.3 Lovable

- **Account**: free tier (or paid if free tier blocks 15 prompts).
- **Snapshot date**: pinned in the eventual results doc; Lovable
  changes weekly.
- **Operator**: me. I will paste the prompt verbatim with no
  follow-up nudging. After each iteration I export the project
  zip and that is the artifact under test.
- **Mitigation against my own bias** (I built polycoder; I also
  operate Lovable): all prompts are pre-committed (§4); operator
  may not edit, simplify, or break apart prompts; if Lovable asks
  a clarifying question, the answer is "use your best judgment".

---

## 6. Metrics

Each metric has an operational definition that is either
fully automated or has a single-pass manual procedure with a
checklist.

### 6.1 Build Pass Rate (BPR) — automated

For each iteration's output:

1. Place the source files in a fresh temp directory.
2. If a `package.json` exists, run `pnpm install && pnpm build`.
3. If no `package.json` (plain static site), run a no-op pass.
4. **Pass** iff exit code 0.

Reported as percent of iterations passing per (system, template).
Headline metric — failures here mean the build artifact does not
exist, which dominates everything else.

### 6.2 Smoke Pass Rate (SPR) — automated

For each iteration that passed BPR:

1. Serve the built `dist/` (or the source if static) on
   `localhost:5174` via `pnpm dlx http-server`.
2. Launch Playwright headless Chromium, navigate to `/`.
3. **Console-clean check**: zero `error`-level console messages
   in the first 3 seconds.
4. **Persistence check** (iteration 2+): every "must keep"
   selector from the previous iteration's golden file
   (`benchmarks/ist/golden/<system>/<template>/iter<NN>.json`)
   must still resolve to a visible element.
5. **Pass** iff both checks pass.

A failure here means the build succeeded but the app regressed —
the most common failure mode the IST is designed to catch.

### 6.3 Test Coverage Maintenance Rate (TCMR) — automated, polycoder-internal only

For polycoder-full and polycoder-coder-only (Lovable does not
generate tests by default; including it here would be apples to
oranges):

1. If the iteration produced tests, run them with the system's
   test command (`pnpm test`, `bun test`, or `npm test` —
   detected from `package.json`).
2. **Pass** iff exit code 0.

Reported separately from BPR/SPR. Headline use is to demonstrate
that polycoder-full's Test Runner role actually maintains a green
suite while polycoder-coder-only does not.

### 6.4 Cyclomatic Complexity Drift (CCD) — automated

For each iteration's source:

1. Run ESLint with `eslint-plugin-complexity` (or `escomplex` for
   non-eslint stacks) over all `.ts/.tsx/.js/.jsx` files.
2. Compute the **mean** cyclomatic complexity across files.
3. Drift at iteration N = `mean(N) − mean(1)`.

Reported as a series. Hypothesis: polycoder-full keeps drift flat
or negative (Long-term Critic + Architect refactor); single-role
systems show monotonically rising drift.

### 6.5 Manual Artifact Review (MAR) — single-pass manual

For each (system, template) combination, after iteration 5:

1. Open the iter-5 build in a real browser at 1280×800.
2. Score on 5 axes (1-5 each): visual polish, layout integrity,
   feature completeness, console hygiene, code organization.
3. Total = sum (range 5-25).

Subjective. Single rater (me). Reported with the explicit
caveat that this is the least defensible metric.

### 6.6 Break / Recovery

Derived from BPR ∧ SPR.

- **Break**: an iteration is broken iff BPR=0 ∨ SPR=0.
- **Time-to-recovery**: number of subsequent iterations until
  next non-broken iteration. (`∞` if never recovered within the
  5-iter window.)

---

## 7. Budget and time caps

### 7.1 Money

| System | Per-iter cost (V0.1 measured) | 15 iters | Buffer |
|--------|-------------------------------|----------|--------|
| polycoder-full | ~$0.12 (V0.1 smoke run) | ~$1.80 | ×2 → cap $4 |
| polycoder-coder-only | ~$0.04 (estimate: 1 role of 8) | ~$0.60 | cap $2 |
| Lovable | $0 free tier; $20/mo paid if needed | $0-$20 | cap $20 |

**Total IST budget cap**: $30 USD. Hard stop if exceeded.

### 7.2 Time

| Phase | Estimate |
|-------|----------|
| polycoder-full runs | 15 × 6min = ~1.5 hr machine, attended | 
| polycoder-coder-only runs | 15 × ~1min = ~15min |
| Lovable runs | 15 × ~3min real-time + waiting | ~1 hr human |
| Build/smoke automation per iter | ~30s | ~25 min total |
| Metrics + write-up | ~5-8 hr human | |

**Total**: ~10-12 hours of focused work. Realistic target: 2-3
calendar days.

---

## 8. Reproducibility

- All prompts pre-committed under `benchmarks/ist/prompts/`.
- All polycoder iterations recorded in SQLite (existing V0.1
  behavior); the IST runner exports per-iteration role I/O traces
  to `benchmarks/ist/runs/polycoder-full/<template>/iter<NN>.json`.
- Lovable transcripts and exported projects saved under
  `benchmarks/ist/runs/lovable/<template>/iter<NN>/`.
- Built artifacts (`dist/`) saved per iter for posterity.
- All metric inputs (`build.log`, `smoke.json`, `complexity.json`)
  saved per iter so anyone can recompute.
- Provider model versions pinned in the eventual results doc.

---

## 9. Honest limitations

This benchmark is **not** evidence at the level a peer-reviewed
paper would accept. Specifically:

- **N=5 iterations per cell** is small. Treat absolute numbers as
  illustrative; lean on directional findings.
- **Single rater for MAR**, who is also the system's author.
- **Lovable is a moving target**; this is a snapshot of one week.
- **Templates are small apps**, not realistic codebases. We claim
  nothing about behavior on multi-thousand-LOC repos.
- **Cost data is for one provider mix**; other mixes (e.g. all
  Claude) would change the economics dramatically.

The defensible claim is: *under the documented setup, with the
documented prompts, on the documented date, the following held*.
That's enough for a portfolio artifact and a starting point for
better follow-up work; it is not enough to claim universal
superiority.

---

## 10. Scope cuts (vs original `todo.md` V0.2 plan)

| Original | Cut to | Reason |
|----------|--------|--------|
| 5 templates | 3 | At ~6 min/iter, 5×10×4 = 200 iter ≈ 20 hrs runtime + 20 hrs human attention. Cutting to 3×5×3 = 45 iter is the minimum that still tests both UI-heavy (landing) and state-heavy (todo + dashboard) failure modes. |
| 10 iters / template | 5 | After ~5 iters in pilot V0.1 work, additional iters mostly re-exercise the same failure modes. Diminishing information per iter. |
| 4 systems (Bolt + Cursor+Claude added) | 3 (Lovable + 2 polycoder variants) | Bolt overlaps Lovable in UX; marginal information. Claude is unavailable / unreliable in polycoder's target market (China), so a Cursor+Claude baseline is off-thesis. polycoder-coder-only replaces them as a cleaner *internal* control. |
| Coverage as headline metric | Coverage as polycoder-internal sub-metric; BPR+SPR as headline | Lovable does not produce tests by default. Headline metrics must be apples-to-apples across all three systems. |

V0.2 sub-tasks affected (will be updated in `todo.md` after this
spec lands):

- V0.2.2 — 5 templates → 3 templates
- V0.2.3 — 10 iter prompts × 5 = 50 → 5 iter prompts × 3 = 15
- V0.2.5/.6/.7 — Lovable + Bolt + Cursor → Lovable only
- New V0.2.5b — polycoder-coder-only runner (~50 LOC harness)

---

## 11. Deliverables

After all 45 runs and metrics computation:

- `docs/benchmark-results-v0.2.md` — the headline writeup.
- `benchmarks/ist/results/raw.json` — every metric, every cell.
- `benchmarks/ist/results/charts/` — generated plots (CCD over
  iters, BPR/SPR per system, etc.).
- A 30-second screen recording of polycoder-full running one
  iteration end-to-end, embedded in the README for recruiters
  who don't want to install anything.

---

## 12. Open questions to resolve before V0.2.4 (runner)

1. **Lovable export format** — does Lovable's "download zip"
   produce a buildable artifact, or does it need flatten-edits?
   Verify before V0.2.4.
2. **Complexity tooling for plain JS apps** — `escomplex` is
   unmaintained; check if `eslint-plugin-complexity` works on
   plain `.js` files without a config explosion.
3. **Lovable rate limits on free tier** — if free tier caps at
   5 messages/day, the IST takes 3 calendar days minimum for
   Lovable alone. Decide: pay for Pro, or pace.
4. **Should polycoder-coder-only call Architect at iter 1 only
   (for project memory bootstrap) and then skip on iters 2-5?**
   This is a more interesting control than "no Architect ever",
   because it tests *whether the per-iteration multi-role pass*
   is what matters, not whether *any architectural framing* helps.
   Decide before writing the harness.

These questions are intentionally left open in the spec; they
will be resolved as ADRs in `docs/decisions.md` (ADR-016 onward)
when V0.2.4 implementation begins.
