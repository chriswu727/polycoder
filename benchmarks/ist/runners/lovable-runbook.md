# Lovable baseline — operator runbook

This is the manual procedure for the **Lovable** system in the
Iteration Survival Test. Lovable is not scriptable from outside,
so you (the operator) run the 15 prompts by hand.

> Sister docs: [`docs/specs/iteration-survival-test.md`](../../../docs/specs/iteration-survival-test.md)
> for the IST design, [`benchmarks/ist/prompts/`](../prompts/) for
> the frozen prompts, [`benchmarks/ist/runners/coderOnly.ts`](./coderOnly.ts)
> for the polycoder-coder-only control.

## Pre-flight

- [ ] **Account** — sign in at https://lovable.dev with the
      account you want to attribute the data to.
- [ ] **Tier decision** — see §1.
- [ ] **Snapshot date** — record today's date in
      `benchmarks/ist/runs/lovable/SNAPSHOT.md` with the model
      ID Lovable shows in its UI (Lovable changes weekly).

## 1. Free tier vs Pro

| | Free tier | Pro ($20/mo) |
|---|---|---|
| Daily prompts | ~5 | unlimited (within reasonable use) |
| Time to finish 15 prompts | ~3 calendar days | one sitting (~1 h) |
| Cost | $0 | $20 (one-time, cancel after) |
| Risk of weekly model change mid-run | High (3-day window) | Low (1-h window) |

**Recommendation**: pay for Pro for one month → run the IST in
one sitting → cancel. The "weekly model change mid-run" risk on
free tier is a real threat to validity (the iter 1 model and the
iter 5 model could differ).

## 2. Per-prompt procedure

For each of the 15 prompts in
[`benchmarks/ist/prompts/`](../prompts/):

1. **Identify the project state**:
   - Iter 1: start a *new* project in Lovable.
   - Iter 2-5: open the project from iter (N-1) and continue.
2. **Send the prompt**, verbatim. Copy from the prompt file —
   do not retype, do not nudge, do not split. If Lovable asks a
   clarifying question, answer "use your best judgment".
3. **Wait** for Lovable to finish generating + the preview to
   reload. Don't proceed until Lovable says it's done.
4. **Capture artifacts** into the snapshot directory:

```
benchmarks/ist/runs/lovable/<template>/snapshots/iter<NN>/
```

   - **Source**: download the project ZIP via Lovable's "Export"
     menu, unzip it into the snapshot dir (so the snapshot dir
     contains `package.json`, `src/`, `index.html`, etc).
   - **Transcript**: copy the chat transcript markdown into the
     same dir as `transcript.md`.
   - **Screenshot**: take a 1280×800 screenshot of the preview at
     iter end and save as `preview.png`.
5. **Repeat** for the next prompt, against the same project.

## 3. Snapshot dir layout (one per iter, per template)

```
benchmarks/ist/runs/lovable/todo/
├── snapshots/
│   ├── iter01/
│   │   ├── package.json
│   │   ├── src/
│   │   ├── index.html
│   │   ├── transcript.md
│   │   └── preview.png
│   ├── iter02/
│   ├── iter03/
│   ├── iter04/
│   └── iter05/
├── snapshots/lovable-meta.json   ← see §4
```

Plus `benchmarks/ist/runs/lovable/dashboard/...` and
`benchmarks/ist/runs/lovable/landing/...`.

## 4. lovable-meta.json (one per template)

A small per-template ledger so the writeup can cite specifics:

```jsonc
{
  "model_id": "claude-sonnet-4-or-whatever-lovable-shows",
  "snapshot_date": "2026-05-08",
  "tier": "pro",
  "project_url": "https://lovable.dev/projects/abc123",
  "iter_durations_minutes": [3.5, 2.0, 4.5, 6.0, 5.0],
  "lovable_clarifying_questions": [
    { "iter": 3, "question": "...", "answer": "use your best judgment" }
  ],
  "operator_notes": "Lovable refused to add nested subtasks at iter 4 — asked twice."
}
```

## 5. Running metrics on Lovable output

After all 15 snapshots are in place:

```bash
pnpm ist-metrics --system lovable --template all --iter all
# (TCMR will be na for Lovable — it doesn't write tests by default)
```

Lovable typically produces Vite + React + Tailwind. The BPR
helper in `benchmarks/ist/metrics/buildPassRate.ts` will detect
`pnpm-lock.yaml` (or fall back to npm) and run install + build
into `dist/`. Heads-up: each cell's `pnpm install` is ~1-2 min
and adds ~150 MB of `node_modules` to a tmp dir; it's cleaned up
after each iter.

## 6. Common pitfalls

- **Lovable trims long prompts**. Iter 5 prompts (the most
  complex) sometimes get truncated in the chat UI. Verify the
  full prompt landed before sending. Re-paste if needed.
- **Lovable opens new conversations on long pauses**. If you
  step away mid-template and the UI logs you out, your project
  state is preserved but the conversation context resets — note
  this in `operator_notes`.
- **Build artifacts inside ZIP**. Lovable's exported ZIP
  sometimes contains a `dist/` from its in-platform build. That's
  fine — BPR's logic will use `dist/` if it exists; otherwise it
  re-builds. Either path is valid for the IST.
- **Path-traversal-shaped filenames**. Lovable occasionally
  generates file paths like `../../foo.txt`. The SPR helper's
  static server blocks these — they'll show up as 403s during
  smoke. Note in operator_notes if observed.
- **Don't edit the prompts mid-experiment**. The freeze rule in
  [`benchmarks/ist/prompts/README.md`](../prompts/README.md)
  applies: if a prompt turns out ambiguous, abort the template,
  edit the prompt, ADR-document the change, and restart that
  template's run from iter 1.

## 7. Time / cost summary

- **15 prompts** × ~3-5 min per prompt (chat + wait + export +
  unzip) ≈ **1-2 hours** of attended human time.
- **$0** if free tier (3 calendar days), **$20** if Pro (1
  sitting).
- Heavier than the polycoder side because Lovable can't be
  scripted; it's the bottleneck of the whole IST.

## 8. After all three templates are done

- [ ] Run `pnpm ist-metrics --system lovable --template all --iter all`.
- [ ] Run `pnpm ist-aggregate` to refresh
      `benchmarks/ist/results/`.
- [ ] Cross-check `benchmarks/ist/runs/lovable/<template>/lovable-meta.json`
      against operator notes.
- [ ] Mark V0.2.6 done in `todo.md`.
