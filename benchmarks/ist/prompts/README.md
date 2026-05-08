# IST prompt library

Pre-committed prompt sequences for the Iteration Survival Test.
See [`docs/specs/iteration-survival-test.md`](../../../docs/specs/iteration-survival-test.md).

## Layout

```
benchmarks/ist/prompts/
├── todo-iter01.md       … todo-iter05.md
├── dashboard-iter01.md  … dashboard-iter05.md
└── landing-iter01.md    … landing-iter05.md
```

Each file contains the **exact, verbatim** prompt that will be
sent to every system under test (polycoder-full,
polycoder-coder-only, Lovable). One prompt per file, no extra
framing — the file content is the prompt.

## Freeze rule

These prompts are **frozen as of the V0.2.3 commit**. Do not edit
mid-experiment. If a prompt turns out to be ambiguous mid-run,
abort that template's run, edit the prompt, restart the template
from iter 1 across all systems, and document the change as an
ADR.

## Why one feature per iter

Each iteration is intentionally one ~feature add — small enough
to be tractable in one prompt, large enough to exercise the
"don't break what existed" discipline. The 5th prompt in each
template is intentionally the most complex; it's the most likely
to reveal regression failures.
