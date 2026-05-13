# Pipeline Quality Iteration Log

Pipeline-quality (vs. feature) iteration. Each round picks one real
vibe-coder prompt, runs it through `pnpm smoke`, inspects what each
of the 8 roles produced, and dials in the weakest layer.

The goal is for a non-technical user typing a one-line Chinese
request to receive a feature-complete, immediately-runnable piece of
software — without the pipeline reflexively reaching for a build
toolchain it doesn't need.

Workflow per round:

1. `pnpm test:node-rebuild` (ABI to Node so smoke can run)
2. `POLYCODER_SMOKE_KEEP_WS=1 POLYCODER_SMOKE_DUMP_ENVELOPES=1
    pnpm smoke --prompt '<vibe-coder prompt>'`
3. `pnpm tsx scripts/inspect-iter.ts --db <smoke.db> --ws <workspace>`
   — dumps every role's envelope + the produced files.
4. Identify which layer's output is the weakest signal.
5. Fix the corresponding role prompt (or harness) — preserve other
   layers as a control.
6. Re-run, compare.

---

## Round 1 — 2026-05-13

**Prompt**: `做一个简单的待办列表网页，可以添加任务、勾选完成、删除任务，刷新页面还在`

**Preset**: budget (DeepSeek + GLM, all 8 roles via 5 models).

### Baseline (before any fix)

- Iteration: `completed` traffic_light `yellow`, 240s, $0.0933.
- 15 files produced, including a full Vite + React + TypeScript +
  Zustand + Tailwind + PostCSS scaffold. User would need `pnpm
  install` and a dev server just to *see* the app.
- First attempt before the Coder tool-call budget was bumped to 80:
  iteration FAILED at Coder with `tool_loop_budget_exceeded` (41
  out of 40 tool calls) — over-engineering had already pulled Coder
  into too many files to finish in budget.
- Test Runner alone burned 496K input tokens / $0.054 (largest
  per-role cost) trying to bootstrap Vitest against a project that
  shouldn't have needed any test framework.

### Failure decomposition (per layer)

| Role          | Output quality | What went wrong |
| ------------- | -------------- | --------------- |
| Translator    | Weak           | DROPPED the "简单" scope signal entirely. `intent_summary` became "Single-user todo list web app with persistence" — no mention that the user explicitly said *simple*. Downstream had no anchor for the size of the build. The prompt's own Example A exhibited the same elision, so the model copied it. |
| Designer      | Parroted Example A | Verbatim three-component output (TaskInputBar / TaskList / TaskItem) with shadcn/ui colors. Designer's §7.1 hardcoded "default to shadcn/ui + Tailwind" with no scope branch. |
| Architect     | Parroted Example A | Architect's Example A literally prescribes Vite + React + TypeScript + Zustand + Tailwind for "todo app." Model produced exactly that recipe. No §7.x "scope sizing" rule existed. |
| Coder         | Followed orders | Loyally produced 15 files matching Architect's guidance — over-engineering propagated. Default tool-call budget (40) wasn't enough; hit the ceiling at file 13ish on first attempt. |
| Adversary     | OK | (Skipped detailed analysis this round.) |
| Long-term Critic | OK | (Skipped.) |
| Test Runner   | Wasteful | No early-exit for plain-HTML projects. Tried to install Vitest, wrote .test.tsx files. 88s + 496K input tokens. |
| Communicator  | Inflated | Reported `completed` with "build done!" tone despite traffic_light=yellow. (Tracked but not the top priority this round.) |

### Fixes applied (this round)

1. **`docs/prompts/01-translator.md` §7.4a**: "PRESERVE SCOPE
   SIGNALS LITERALLY" — explicit rule to keep "简单/小/迷你/quick/
   simple/tiny" verbatim in `inferred_constraints`. Example A
   updated to include `"User explicitly said 简单 — keep
   implementation minimal, no build tools unless absolutely
   needed"` as the first constraint.
2. **`docs/prompts/02-designer.md` §7.1**: rewrote from
   "default to shadcn/ui + Tailwind" to a scope-aware branch:
   simple/小 → plain semantic HTML + vanilla CSS, no library;
   ≥5 features or framework signal → shadcn/Tailwind. Example A
   replaced with the simple-path version (sections in one HTML
   file, not React components).
3. **`docs/prompts/03-architect.md` §7.7** (NEW) "Scope sizing":
   explicit upgrade signals table, default to one `index.html`
   with vanilla JS + `localStorage`, upgrade to bundler only if
   ≥4 features share state OR ≥4 components OR explicit framework
   request OR existing project_memory commits. §7.8 NEW: "Reject
   the Designer's stack overreach" when scope is small.
4. **`docs/prompts/03-architect.md` Examples**: replaced over-
   prescribing Example A with two examples — Example A (simple →
   one file) and Example B (complex/upgraded → React+Vite). The
   old conflict-detection example is now Example C.
5. **`docs/prompts/07-test-runner.md` §7.4a** (NEW): "Plain-HTML
   / no-build projects — DO NOT bootstrap a framework." Emits
   `cannot_run` + 2-4 manual-verification bullets instead of
   installing Vitest into a 100-line static page.
6. **`core/roleHarness/invokeRole.ts` `TOOL_CALLS_BY_ROLE`**:
   tighter Test Runner budget (15, down from 40) to enforce the
   no-bootstrap rule; Coder default 40 retained for now (the
   real fix is Architect not asking for 15 files).
7. **`scripts/smoke.ts`**: dumps every role envelope (success or
   failure) when `POLYCODER_SMOKE_DUMP_ENVELOPES=1`. Keeps DB
   when `POLYCODER_SMOKE_KEEP_WS=1` so `scripts/inspect-iter.ts`
   can be re-run later without losing data.

### After-fix smoke (Round 1 verification)

Same prompt, same preset, same models. Coder tool-call budget was
temporarily bumped 40→80 to remove the budget cliff while diagnosing;
default 40 will be restored once the fix is verified at multiple
prompt sizes.

| Metric           | Baseline (smoke 2) | After fix (smoke 3) | Delta              |
| ---------------- | ------------------ | ------------------- | ------------------ |
| files_changed    | 15                 | **1** (`index.html`) | **−93 %**          |
| duration         | 240 s              | **143 s**           | **−40 %**          |
| total_cost_usd   | $0.0933            | **$0.0295**         | **−68 %**          |
| traffic_light    | yellow             | **green**           | clean              |
| test_runner cost | $0.0538 / 88 s     | **$0.0097 / 16 s**  | **−82 %**          |

What each layer actually emitted (smoke 3):

- **Translator**: `inferred_constraints[0] = "User explicitly said
  简单 / 简单的 — keep implementation minimal, no build tools, no
  frameworks unless absolutely needed"`. Signal preserved.
- **Designer**: summary `"Single-screen, mobile-first todo list,
  plain HTML, no component library"`. `AddTaskForm` marked as
  "semantic HTML section, NOT a separate file." Override taken.
- **Architect**: prescribed one `index.html`, vanilla JS,
  `localStorage`. Explicitly listed Vite/React/Tailwind in
  `patterns_to_avoid`. §7.7 scope-sizing applied correctly.
- **Coder**: produced a single 6.9 KB / 288-LOC `index.html` with
  inline `<style>` + `<script>`.
- **Test Runner**: `cannot_run` + 4 manual-verification bullets in
  `coverage_assessment.uncovered_paths`. No `pnpm install vitest`.
  Spent 16 s instead of 88 s.

**Functional verification** — drove the produced `index.html` via
chrome-devtools headless:

1. ✅ Add task: typed "买牛奶" + click 添加 → row appears with
   checkbox + label + delete button.
2. ✅ Toggle done: clicked the checkbox → row gets `checked`, the
   `aria-label` flipped from "标记为已完成" to "标记为未完成"
   (model added accessibility unprompted).
3. ✅ Delete: clicked the × button on "取快递" → row removed.
4. ✅ Refresh persistence: reloaded the page → "买牛奶" (still
   checked) is restored from `localStorage`, "取快递" stays gone.

For a vibe coder, this is the expected behavior. Double-click the
`index.html` in Finder, the app works.

### Round 1 conclusion

The single highest-leverage change was preserving the **scope signal**
("简单") through the role chain. Once Translator kept it in
`inferred_constraints` and Architect honored it via §7.7 scope-sizing,
the whole downstream collapsed to the right size. Test Runner's
no-bootstrap rule saved an additional 70+ seconds + $0.04.

### Round 1 hardening — anti-parrot prelude

Smoke 4 (same prompt, default Coder budget) showed the fix was
non-deterministic: Translator sometimes parroted its own §4 worked
example ("Personal expense-tracking app with receipt scanning") and
ignored the actual user prompt about a todo list. Fixed two ways:
(1) envelopeBuilder.ts now prepends `<<<USER_PROMPT_START>>>…<<<USER_
PROMPT_END>>>` above the `<role-input>` envelope for Translator only,
so the user's verbatim prompt is always the most prominent thing in
the user message. (2) §4 of the Translator prompt replaced the
fully-worked expense-tracker example with a structure-only schema
walkthrough + a warning that §10 examples illustrate FORMAT only.

Smoke 5 (post-fix, same prompt) cleanly hit `green` again with
intent_summary correctly anchored to the todo list.

---

## Round 2 — 2026-05-13

**Prompt**: `做一个记账小工具，可以输入金额和说明，看到本月总支出，刷新还在`
(deliberately NO "简单" word — tests §7.7 default behavior without a
scope-signal anchor).

### Baseline (smoke 6)

- Iteration: `completed` traffic_light `yellow`, 198 s, $0.0611.
- Single `index.html` ✓ — Architect §7.7 default holds without the
  word "简单" (Translator picked up "小工具" → "small tool, single
  HTML file, no build tools").
- **BUT**: Adversary silently failed (cost breakdown showed only 6
  roles, no adversary). And Communicator fabricated content
  ("Adversary 提醒登录功能没有限流" — no login feature exists in this
  expense-tracker app; "1 个测试没有通过：空格作为金额" — Test Runner
  was `cannot_run`, zero tests ran; "运行 `bun dev`" — static HTML
  has no dev server).
- The `stats` block had hallucinated values (`Claude-Sonnet-4-6`,
  `Claude-Opus-4-6`, `Qwen-Max`, `$0.04`, `87s`) — none of those
  models or numbers were real for the run. They were copied verbatim
  from §10 Example A.

### Failure decomposition (Round 2)

| Role         | What went wrong |
| ------------ | --------------- |
| Adversary    | Silently dropped: parallelReviewers branch in runIteration.ts only added envelope when `status === 'success'` and never logged the failure. Root cause: GLM-4-plus API returned HTTP 429 `余额不足` (insufficient resource pack). |
| Long-term Critic | Hit the 12-tool-call budget on a 300-LOC index.html (13/12). Budget too tight. |
| Communicator | Two failure modes: (a) fabricated `stats` block (model names, cost, duration) verbatim from its §10 Example A; (b) invented role outputs for missing reviewers ("Adversary said X" when Adversary had no envelope). The prompt §7.6 referenced a `<stats>` element that the orchestrator was never actually injecting, so the model fell back to copying the example's values. |

### Fixes (Round 2)

1. **runIteration.ts**: parallelReviewers branch now builds a
   `reviewerFailures` list, emits `role_failed` events, and
   `console.warn`s each failure with reason + truncated detail. No
   more silent drops.
2. **runIteration.ts (Communicator)**: inject a real `stats` block
   into Communicator's task JSON — total_cost_usd from CostTracker,
   duration_seconds from `trace.startedAt`, `models_used` /
   `models_by_role` derived ONLY from envelopes actually present,
   `reviewers_missing` for explicit absence-marking.
3. **iterationTrace.ts**: trace now exposes `startedAt` so the
   orchestrator can compute duration without re-querying the DB.
4. **08-communicator.md §7.6**: rewritten to point at the now-real
   `stats` block; "NEVER invent stats" rule.
5. **08-communicator.md §7.7 (NEW)**: "NEVER fabricate role output
   (CRITICAL)" — missing roles must be acknowledged honestly,
   traffic_light drops to yellow on missing reviewer, Test Runner
   `cannot_run` must NOT be reported as "X tests failed."
6. **08-communicator.md Examples A + B**: stats values replaced with
   `<placeholders from <stats>>`; Example B's whole login/rate-limit
   scenario rewritten as a TEMPLATE with placeholders. `what_changed`
   also templated so model can't copy "新建了 src/store/tasks.ts" /
   "3 个组件" for an app that only has one index.html.
7. **invokeRole.ts TOOL_CALLS_BY_ROLE**: `long_term_critic` 12 → 18.
8. **workspaceHandlers.ts PRESET_DEFINITIONS.budget**: Adversary
   switched from `glm-4-plus` (requires paid resource pack) to
   `deepseek-chat` so vibe-coders can run the pipeline on
   always-available DeepSeek credits.

### After-fix smoke (Round 2 verification — smoke 8)

- Iteration: `completed` traffic_light `yellow`, 213 s, $0.0572.
- 1 file (`index.html`, 234 LOC).
- Adversary RAN (deepseek-chat, $0.0152) — its real issues surfaced.
- Communicator stats are real now: 0 fabricated models, real cost.
- Test Runner still hit its tighter budget (16/15 — bumped to 25
  this round).
- Adversary stance attributed correctly to "DeepSeek-Chat" (not
  parroted "Qwen-Max").

**Functional verification** — drove the produced expense tracker via
chrome-devtools headless:

1. ✅ Input form with `金额` (number) + `说明` (text) renders, defaults
   to "本月总支出: 0.00", empty hint shows "暂无记录".
2. ✅ Add `¥35.50 / 午餐` → row appears with timestamp `05-13 16:23`,
   total updates to `本月总支出: 35.50`.
3. ✅ Add `¥120 / 打车` → second row appears, total accumulates to
   `本月总支出: 155.50` (35.50 + 120.00 — derived math correct).
4. ✅ Reload page → both rows + total of `155.50` persist exactly.
5. ✅ Delete button present per row.

For this prompt — given to a non-technical user, no `简单` keyword,
includes a derived computation (monthly sum) — polycoder produced a
working, persistent, single-file app on the first try with the budget
preset (DeepSeek + GLM-Flash only, total $0.06). That is the
end-to-end success the goal asked for.

### Round 2 conclusion

Two structural fixes propagate from smoke 6 to smoke 8:
- Reviewer-failure transparency stops Communicator from inventing
  content for missing roles.
- Real `stats` injection stops Communicator from copying §10 Example
  values verbatim.

Open follow-ups for future rounds:
- Test Runner budget hit 16/15 (bumped to 25, monitor next run).
- Long-term Critic budget hit 13/12 (bumped to 18, monitor).
- For real cross-PROVIDER adversarial review on the budget preset,
  user will need a working GLM-4-Plus credit balance OR pick the
  china_pro / mixed preset.

---
