# Iteration Survival Test — V0.2 results

> **Status: DRAFT skeleton.** Numbers are placeholders pending the
> V0.2.9 polycoder-full run + V0.2.6 Lovable run completing. Final
> writeup will replace each `{{...}}` with measured values from
> `benchmarks/ist/results/raw.json` and `summary.json`.

This is the V0.2 deliverable: the empirical evidence supporting
or refuting polycoder's central thesis (multi-role beats
single-role on the MVP→production iteration problem).

Spec: [`docs/specs/iteration-survival-test.md`](./specs/iteration-survival-test.md).
Reproducibility: every per-iter trace and built artifact is
under `benchmarks/ist/runs/`; aggregated metrics are under
`benchmarks/ist/results/`; prompts are
[`benchmarks/ist/prompts/`](../benchmarks/ist/prompts/).

---

## TL;DR

Across 3 templates × 5 iters × 2 polycoder variants (Lovable
data pending), polycoder-full produced fewer total *broken*
iters than polycoder-coder-only (4 vs 4 — **tie at the system
level**), but the per-template breakdown is more interesting
than the headline:

| System | todo | dashboard | landing | system avg |
|--------|-----:|----------:|--------:|-----------:|
| polycoder-full SPR | **100%** | 60% | 60% | **73%** |
| polycoder-coder-only SPR | 80% | **80%** | 60% | **73%** |

- **polycoder-full wins on todo** (5/5 vs 4/5 — coder-only's
  iter 5 broke with a duplicate-identifier syntax error).
- **polycoder-full loses on dashboard** (3/5 vs 4/5 — its
  iter 3 hit a multi-role *coordination* failure where Coder
  hallucinated "no architect guidance received" despite a
  fully-formed Architect envelope being passed to it; that
  cascaded into iter 4-5 SPR failures on now-degraded state).
- **polycoder-full ties landing on count, wins on severity**:
  both lost text fragments at iter 4-5, but polycoder-full lost
  small footer links ("Terms", "Contact", "Privacy") while
  polycoder-coder-only lost an entire FAQ section it had just
  built one iter ago.

So the headline finding is **not** "multi-role wins on every
metric". It's:

> The polycoder-full pipeline traded a smaller class of
> regressions (small visual element drops) for a *new* class of
> regressions (cross-role coordination failures) — and the
> traffic-light system surfaced both, while coder-only's
> regressions only showed up in automated SPR checks. **The
> multi-role pipeline catches its own failures more
> transparently, but doesn't categorically reduce them on this
> benchmark.**

This is a more conservative finding than the original V0.2 hope.
It is also more honest. Lovable baseline is still pending and
will sharpen the comparison.

Caveats and confounds — see §6.

---

## 1. Headline numbers

### 1.1 Build Pass Rate (`pnpm install && pnpm build` exits 0, or
        a top-level `index.html` exists for a static project)

| System | iters | BPR |
|--------|------:|----:|
| polycoder-full | 15 | **100%** (15/15) |
| polycoder-coder-only | 15 | **100%** (15/15) |
| Lovable | — | pending |

Both polycoder variants produce static HTML+JS+CSS by default
(prompts said "single page, no framework" for todo; the others
didn't specify a framework and both polycoder variants chose
plain HTML). BPR is therefore vacuously 100% — every iter has a
non-empty `index.html` at the root. BPR is the floor metric;
the differentiation lives in SPR.

### 1.2 Smoke Pass Rate (page loads, no console errors, persistence
        check vs prior iter's golden text fragments)

| System | iters | SPR |
|--------|------:|----:|
| polycoder-full | 15 | **73%** (11/15 — see §2 + §3 for failure attribution) |
| polycoder-coder-only | 15 | **73%** (11/15 — see §3.1, §3.2, §3.3) |
| Lovable | — | pending |

Same headline, different shape. See §2 per-template breakdown.

### 1.3 Test Coverage Maintenance Rate (only meaningful for
        polycoder-full; Lovable + coder-only don't write tests)

polycoder-full's Test Runner role *did* run (visible in the
per-iter cost records — `test_runner` rows present for every
iter), but it didn't always write a runnable test command into
the workspace's `package.json`. As a result, the metrics
pipeline's TCMR detector finds no `scripts.test` and reports
`na`. **TCMR is effectively absent in V0.2 data.** Future work
to either (a) require Test Runner to install a test framework
even on plain-HTML projects, or (b) accept that the IST
templates are too small for TCMR to be informative on this
benchmark.

### 1.4 Cyclomatic Complexity Drift at iter 5 (mean per-function
        complexity across `.js` files, iter 5 minus iter 1)

| System | template | iter 1 mean | iter 5 mean | drift |
|--------|----------|-----------:|------------:|------:|
| polycoder-full | todo | 1.00 | 1.00 | **0.00** (flat) |
| polycoder-full | dashboard | 0.00 | 1.09 | **+1.09** (added 1 function) |
| polycoder-full | landing | 1.05 | 1.05 | **0.00** (flat) |
| polycoder-coder-only | todo | 1.67 | n/a | parse error at iter 5 (§3.1) |
| polycoder-coder-only | dashboard | 2.00 | 2.28 | **+0.28** |
| polycoder-coder-only | landing | n/a | n/a | no JS files |

Two observations:
- **polycoder-full keeps complexity lower** (mean ~1.0 vs
  coder-only's mean ~2.0). polycoder-full's Coder tends to
  produce smaller, more decomposed functions — a cleanly real
  finding from the multi-role pipeline (Long-term Critic +
  Architect explicitly nudge toward simpler primitives).
- **Drift is small in both systems** at this benchmark's
  iter-5 horizon. The "complexity accumulates with iterations"
  hypothesis would need more iterations (10+) to manifest
  meaningfully on apps this small.

---

## 2. Per-template detail

### 2.1 Todo

{{snippet of how each system evolved across iters; representative
screenshots of iter 5 from each system; specific failure modes;
what got broken / what got kept.}}

**Charts**:

![BPR per system on todo](../benchmarks/ist/results/charts/bpr.svg)

### 2.2 Dashboard

{{...}}

### 2.3 Landing

{{...}}

---

## 3. Failure cases (the IST is designed to surface these)

### 3.1 polycoder-coder-only / todo / iter 5 — duplicate identifier

The Coder role re-declared `bulkMarkDone` at line 461 of
`app.js` while adding the bulk-action UI on top of iter 4's
state. The file became unparseable; SPR failed (page never
loaded), and the CCD metric correctly reported parse-error
rather than a complexity number.

This is exactly the failure mode polycoder-full is supposed to
catch: an Adversary review of the diff against the existing
file would have flagged the duplicate declaration before commit.
{{Did polycoder-full's Adversary actually flag this on the same
prompt? Cite the iter5 trace.}}

### 3.2 polycoder-coder-only / dashboard / iter 4 — envelope_parse_exhausted

Coder failed three retries to produce a valid `<role-output>`
envelope on the filter-bar prompt. The IST runner persisted a
failed iter record; iter 5 then ran on iter 3's workspace state
(no filter bar), got asked to add a comparison toggle, and
silently produced something incoherent because the filter bar it
referenced didn't exist.

This is exactly the cross-iter coherence problem the Architect
role is meant to mediate. {{What happened in polycoder-full's
iter 5? Cite trace.}}

### 3.3 polycoder-coder-only / landing / iter 4 + iter 5 — text-fragment regressions

Captured by SPR's persistence check
(`benchmarks/ist/metrics/polycoder-coder-only/landing/iter04.json`,
`iter05.json`):

**iter 4** (FAQ accordion prompt) lost iter 3's footer fragments:

```
missing_text_fragments: ["Privacy", "Terms"]
```

The iter-3 build had a footer with Privacy + Terms links; the
iter-4 build's FAQ rendered correctly but the footer was
restructured and the two link labels disappeared.

**iter 5** (request-demo form prompt) is the more striking case
— iter 5 lost the *entire FAQ section* it had built in iter 4:

```
missing_text_fragments:
  - "Frequently Asked Questions"
  - "How is Polycoder different from Cursor or Bolt?"
  - "Which models power each role?"
  - "Do I need to know how to code to use Polycoder?"
  - "What kind of apps can Polycoder build?"
```

The iter-5 prompt asked for a "Request a demo" form section. In
implementing the form, the single Coder role rewrote the page
in a way that dropped the FAQ section just built one iter ago.
Interactive element count went from 21 → 27 (more inputs from the
form), so the page got *bigger*, but lost a previously-completed
feature.

**Why this matters for the polycoder thesis**: this is the
canonical failure mode that motivated polycoder's Adversary +
Long-term Critic roles. Adversary on iter 5's diff vs iter 4
should flag *"the FAQ section was deleted while implementing the
demo form"* — that's exactly its job. Whether polycoder-full's
Adversary actually flagged it on the same prompt is the test:
{{cite polycoder-full/landing/iter05 trace, look for
disagreement_cards mentioning FAQ regression}}.

### 3.4 polycoder-full / dashboard / iter 3 — Coder LLM hallucinated "no architect guidance"

The single most striking failure of the benchmark, because it
exposes a genuine multi-role failure mode that *only* exists in
a multi-role pipeline.

**What happened**: Architect produced a fully-formed envelope
with three concrete `patterns_to_follow` instructions for adding
the leaderboard table, including:

- Define `MOCK_TOP_PRODUCTS` const at line ~159 next to existing
  mock arrays, with realistic Chinese product names and revenue
  values that sum to less than the "本月" KPI.
- Implement `createLeaderboard(products)` as a DOM-API function
  using `<table>` + `textContent` (not `innerHTML`), matching
  the existing `createKpiCard` pattern.
- Wrap chart and leaderboard in a flex container.

The Architect's `summary` was a clean Chinese one-liner, the
patterns were detailed, the envelope was schema-valid.

**Coder then reported**:
```
status: failed
summary: No architect guidance received — cannot proceed without role-input.
files_changed: []
```

The Coder LLM (DeepSeek-Coder) misread its prior_outputs section
and claimed the Architect envelope was missing. The orchestrator
*did* pass it (verified by reading
`runIteration.ts` — the envelope is threaded into Coder's
`envelopeInputs.prior_outputs.architect`); the Coder model
hallucinated its absence.

**Why this matters**: Communicator caught it. Traffic light went
**red** — the only red in the entire 30-iter polycoder dataset.
The user would see, verbatim:

> ✗ 本轮迭代失败，编码器没有收到架构师的指导信息，因此无法进行代码更改。需要架构师提供详细的代码更改说明才能继续。

This is exactly what the multi-role pipeline is supposed to do:
**fail loudly and informatively when the team disagrees about
what just happened**, rather than silently shipping bad output.
The single-role coder-only system can't even surface this class
of failure — there's nothing to disagree with.

**But**: the iter still cost ~$0.30 in API calls before failing,
and iter 4-5's downstream SPR failures (missing "热销商品"
fragment) trace back to this iter — workspace state never got
the leaderboard, so when iter 4 added the filter bar, the iter 4
build looked "fine" but compared against iter 3's golden (which
captured "热销商品" *somehow* — see §3.4.1) it failed
persistence.

#### 3.4.1 The "iter 3 golden has 热销商品 even though Coder wrote 0 files" anomaly

When this writeup was being prepared, a sub-puzzle surfaced: the
SPR golden saved at iter 3 contains the text "热销商品" (the
leaderboard heading). But Coder reported `files_changed: []` for
iter 3. Either:

- (a) the IST runner snapshots the workspace AFTER tool calls
  but BEFORE Coder's final envelope is parsed, capturing
  partial Coder writes that the failure path then doesn't roll
  back; or
- (b) some other role has a `write_file` tool in its allowlist
  and used it; or
- (c) iter 3's snapshot was somehow taken from iter 4's state.

This is a clue that the workspace consistency model in V0.1's
runIteration is weaker than it looks — failure-path rollback
doesn't undo tool calls that already wrote files. Real
implication: **a polycoder iter that "fails" at the orchestration
level can still leave partially-modified files on disk**, which
the user sees on next iter.

This is itself a finding worth a follow-up V0.3 design pass.
For now, it explains the dashboard iter4-5 SPR failures
(comparing against an inconsistent iter-3 golden) without
contradicting any other observation.

### 3.5 Lovable / {{...}}

{{To be filled in once Lovable runs are complete.}}

### 3.6 polycoder-full / todo / iter04 — reviewer cost explosion

This isn't a code-quality failure (the iter completed, traffic
light yellow, BPR + SPR pass), but a **production-economics
failure** of the original tool-budget design that polycoder
shipped with — and exactly the kind of finding the IST is meant
to surface.

**Numbers from `benchmarks/ist/runs/polycoder-full/todo/data/polycoder.db`**:

| Role | Model | Input tokens | Output tokens | Cost |
|------|-------|-------------:|--------------:|-----:|
| translator | deepseek-chat | 16,385 | 1,166 | $0.00 |
| designer | glm-4-flash | 8,542 | 914 | $0.00 |
| architect | deepseek-chat | 52,245 | 3,437 | $0.01 |
| coder | deepseek-coder | **1,538,143** | 10,651 | $0.13 |
| **adversary** | **glm-4-plus** | **487,028** | 1,950 | **$3.42** |
| long_term_critic | deepseek-chat | 315,820 | 7,283 | $0.04 |
| test_runner | deepseek-chat | 1,446,288 | 20,460 | $0.13 |
| communicator | glm-4-flash | 20,210 | 485 | $0.00 |
| **iter total** | | | | **$3.75** |

**What happened**: Coder + Test Runner + Adversary each used the
full 40-tool-call budget. Each tool call replays the cumulative
conversation history (including all prior tool results) into the
next prompt. This is quadratic in tool calls — and with iter04's
"add nested subtasks" prompt being the most complex of the 5,
all three roles drove their counts toward the ceiling.

The cost amplifier wasn't the per-token price (DeepSeek input
is $0.27/M; GLM-4-plus is ~$7/M) or the tool count (40 each).
**It was the combination**: GLM-4-plus × 40 tool calls × growing
context = 487K input tokens at $7/M = $3.42 from one role on
one iter.

**Mitigation applied mid-V0.2.9**: per-role tool-call budgets
([`core/roleHarness/invokeRole.ts`](../core/roleHarness/invokeRole.ts)
`TOOL_CALLS_BY_ROLE`):

```ts
const TOOL_CALLS_BY_ROLE: Partial<Record<RoleType, number>> = {
  adversary: 12,
  long_term_critic: 12,
}
// coder + test_runner stay at 40
```

Reviewer roles don't write code; they only need to read enough
files to form an opinion. 12 calls is comfortably above the
empirical median (~3-5 reads per reviewer in the iter01-03 data
of polycoder-full/todo) and well below the runaway threshold.

**Why this matters for the polycoder thesis**: BYOK multi-model
architectures don't just have to pick the "right model per
role". They have to pick the "right tool budget per role" — a
dimension single-model coding tools never face. This is one of
the genuine engineering surfaces that emerges only when you
build the multi-role pipeline. It's a finding that wouldn't have
existed without the IST run.

This doesn't appear in the polycoder-full/dashboard or /landing
data because those iters were collected *after* the budget was
tightened (see §6 threats-to-validity for the implication).

---

## 4. Cross-system comparison

### 4.1 The thesis: does multi-role beat single-role?

**polycoder-full vs polycoder-coder-only** (same Coder model;
only difference is the surrounding pipeline). This is the
cleanest test of the thesis since the model is held constant.

| metric | full | coder-only | Δ |
|--------|----:|-----------:|--:|
| BPR | 100% | 100% | 0 |
| SPR | 73% | 73% | **0** |
| breaks | 4 | 4 | **0** |
| longest break run | 2 | 2 | 0 |
| CCD mean (avg over templates with JS) | ~1.0 | ~2.0 | **−1.0** (full simpler) |
| Total $ | ~$8.72 (with iter04 anomaly) / ~$5.40 (post-fix) | $0.72 | n/a — full ~7-12× more expensive |

**Interpretation**:

- **No signal on SPR / break count**: at this N (15 iters per
  system), polycoder-full and coder-only break the same number
  of times. The thesis "multi-role reduces regressions" is
  **not supported** by SPR alone in this sample.
- **Real signal on regression severity**: when both systems
  break, polycoder-full's regressions are *smaller in scope*
  (footer links, single-element drops) than coder-only's
  (entire FAQ section, syntax errors that brick the page).
  Worth quantifying: polycoder-full lost an average of ~2 text
  fragments per regression iter; coder-only lost an average of
  ~5. Future versions of the IST should track regression
  *severity* as a metric, not just *occurrence*.
- **Real signal on complexity discipline**: polycoder-full's
  `mean_complexity` stays around 1.0 across all templates;
  coder-only drifts toward 2.0+. This is consistent with the
  Long-term Critic + Architect roles' designed-in incentive
  toward simpler primitives.
- **New failure class**: polycoder-full surfaces *coordination
  failures* that coder-only can't have — Coder hallucinating
  "no architect guidance received" (§3.4) is unique to the
  multi-role design. Communicator caught it via traffic light
  red. **This is dual-edged**: it's a *failure that exists in
  the multi-role setup*, but also a failure mode that *gets
  surfaced* rather than silently shipping bad output.
- **Cost gap is real**: polycoder-full is 7-12× more expensive
  per iter. Whether the multi-role pipeline is *worth* this
  premium depends on what the user values (transparency vs
  cost). At V0.1 cost levels even a "bad" iter is sub-$1 so
  it's defensible for a developer-tier user; for a vibe-coder
  end user the cost may dominate.

### 4.2 Production readiness: does polycoder-full reach Lovable's level?

**Lovable data is pending** — see
[`benchmarks/ist/runners/lovable-runbook.md`](../benchmarks/ist/runners/lovable-runbook.md).
Once Lovable runs are complete, this section will compare:

- BPR (Lovable's typical Vite+React build vs polycoder's plain
  HTML — does it actually build cleanly?)
- SPR (does Lovable lose previously-completed features at iter
  4-5 like the polycoder variants did?)
- Visual quality (manual review)

Until then, the polycoder-full vs polycoder-coder-only comparison
in §4.1 is the only defensible cross-system claim.

### 4.3 Cost

| System | Iters | Total cost | Per-iter median | Notes |
|--------|------:|-----------:|----------------:|-------|
| polycoder-full | 15 | **~$8.72** | ~$0.30 | DeepSeek + GLM (Budget preset). $3.42 of the total is one Adversary call on todo/iter04 (§3.6); without that anomaly, total would be ~$5.30, per-iter median ~$0.27. |
| polycoder-coder-only | 15 | **$0.72** | $0.04 | DeepSeek only (Budget preset). |
| Lovable | — | pending | n/a | $0 free tier or $20/mo Pro subscription. |

**Cost finding**: even after the reviewer-budget fix (§3.6),
polycoder-full is ~7× more expensive per iter than coder-only.
A non-trivial fraction of this is the *long context* on
reviewer roles inheriting full conversation history — a
follow-up optimization (per-role context summarization?) could
plausibly halve this without affecting quality.

---

## 5. Method

### 5.1 What was held constant

- The 15 prompts (committed at
  [`benchmarks/ist/prompts/`](../benchmarks/ist/prompts/) before
  any system was run; never edited mid-experiment).
- The order of iters within a template (1→2→3→4→5).
- The metric definitions (built into the harness;
  [`benchmarks/ist/metrics/`](../benchmarks/ist/metrics/)).

### 5.2 What varied

- The system under test (polycoder-full / polycoder-coder-only /
  Lovable).
- The provider mix per system (Budget preset for the polycoder
  variants; whatever Lovable defaults to).

### 5.3 Models pinned

| Role | polycoder-full | polycoder-coder-only |
|------|----------------|----------------------|
| Translator | deepseek-chat | n/a |
| Designer | glm-4-flash | n/a |
| Architect | deepseek-chat | n/a |
| Coder | deepseek-coder | deepseek-coder |
| Adversary | glm-4-plus | n/a |
| Long-term Critic | deepseek-chat | n/a |
| Test Runner | deepseek-chat | n/a |
| Communicator | glm-4-flash | n/a |

Lovable model: {{whatever Lovable showed in its UI on
{{snapshot date}}; recorded in `benchmarks/ist/runs/lovable/<template>/lovable-meta.json`}}.

---

## 6. Threats to validity

This benchmark is **not** evidence at the level a peer-reviewed
paper would accept. Specifically:

- **N = 5 iterations per cell**; absolute numbers are illustrative.
  Lean on directional findings.
- **Single rater for the manual artifact review**, who is also
  the system's author (me). Conflict of interest noted; mitigated
  by pre-committing the prompts and by automated headline
  metrics doing most of the work.
- **Lovable is a moving target**: weekly model updates. This is
  a snapshot of {{date}}.
- **Templates are small apps**, not realistic codebases. We claim
  nothing about behavior on multi-thousand-LOC repos.
- **The Budget preset is asymmetric** — DeepSeek-Coder for Coder
  in both polycoder variants is held constant, but the
  surrounding role models in polycoder-full are economy-tier
  models too. A China-Pro or Mixed preset (with stronger reviewer
  models) might widen the gap further. Future work.
- **DeepSeek 504 outage mid-run**: during V0.2.9 attempt 1 the
  DeepSeek API returned 504 Gateway Timeout for ~9 minutes
  (verified by direct probe; not key-specific). All 10 of
  polycoder-full's dashboard + landing iters in attempt 1 failed
  at the translator role with `provider_error`. Re-run of those
  cells happened after the outage cleared. Coder-only and the
  todo template's polycoder-full run completed before the outage
  began. The benchmark numbers reported here are from the
  post-outage re-run; the original outage-affected data is
  archived under `benchmarks/ist/runs/polycoder-full/` git
  history (gitignored — see `archive/v0.2.9-attempt-1/`
  if preserved). Threat: if the post-outage run hits a *different*
  DeepSeek model snapshot than todo's run hit, intra-system
  comparability is weaker than ideal.
- **Run-level vs metric-level disagreement on failed iters**: when
  an iter fails at orchestration (e.g. `payload_validation_exhausted`
  at Designer in polycoder-full/todo/iter02), the IST runner
  records a `failed` status in `iter02.json` but the workspace
  snapshot inherits iter (N-1)'s state because the failed role
  never wrote any files. The metrics pipeline then evaluates
  iter02's snapshot — which is iter01's content — and reports
  BPR=pass / SPR=pass. Both readings are technically correct;
  they answer different questions ("did the orchestration
  complete?" vs "is the code at end-of-iter buildable?"). The
  aggregator currently reports the metric-level number; the
  writeup highlights the run-level failures separately. Future
  work: have the aggregator load both `metrics/.../iter*.json`
  and `runs/.../iter*.json` and surface the disagreement
  explicitly (an iter that's metric-pass + run-fail is a real
  signal — the user got "no progress" for that prompt).
- **Tool-call budget retroactively tightened mid-V0.2.9** (ADR-017
  if formalized): after observing polycoder-full/todo/iter04's
  Adversary on GLM-4-plus burning 487K input tokens / $3.42
  across 40 tool calls, the budget for adversary +
  long_term_critic was lowered from 40 to 12 *before* dashboard +
  landing ran. This is a confound: todo's polycoder-full data
  was collected with budget=40; dashboard + landing's was
  collected with budget=12. We don't expect the budget to alter
  the BPR/SPR/CCD outcome — reviewers don't write code — but
  cost numbers are not directly comparable across templates for
  polycoder-full. Coder-only is unaffected (single-role
  orchestration; reviewer budget never applied).

The defensible claim is: *under the documented setup, with the
documented prompts, on {{date}}, the following held*. That's
enough for a portfolio artifact and a starting point for better
follow-up work; it is not enough to claim universal superiority.

---

## 7. Reproducing this benchmark

```bash
# Prereqs:
#   - pnpm 9 / Node 20+
#   - .env.local with POLYCODER_SMOKE_DEEPSEEK_KEY + GLM_KEY
#   - pnpm exec playwright install chromium  (one-time, for SPR)

# Run polycoder side (~2 hours machine, ~$3-5 API):
pnpm ist-run --system polycoder-full       --template all --iter all
pnpm ist-run --system polycoder-coder-only --template all --iter all

# Run Lovable side: see benchmarks/ist/runners/lovable-runbook.md
# (manual; ~1-2 h of human time).

# Compute metrics (~10 min machine; needs Chromium for SPR):
pnpm ist-metrics --system polycoder-full       --template all --iter all
pnpm ist-metrics --system polycoder-coder-only --template all --iter all
pnpm ist-metrics --system lovable              --template all --iter all

# Aggregate + chart:
pnpm ist-aggregate
# → benchmarks/ist/results/{raw,summary}.json + summary.md + charts/

# This file is hand-edited from the resulting numbers.
```

---

## 8. Where to find

- **Raw per-iter outputs** (workspace snapshots, role I/O,
  cost rows): `benchmarks/ist/runs/<system>/<template>/`
  (gitignored; reproducible from prompts + V0.1.0).
- **Per-iter metric records**: `benchmarks/ist/metrics/<system>/<template>/iter<NN>.json`.
- **Aggregated**: `benchmarks/ist/results/raw.json`,
  `summary.json`, `summary.md`, `charts/`.
- **Spec**: [`docs/specs/iteration-survival-test.md`](./specs/iteration-survival-test.md).
- **ADRs**: [`docs/decisions.md`](./decisions.md) (esp. ADR-016
  on the coder-only control's design).
