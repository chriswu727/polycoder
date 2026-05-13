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

---
