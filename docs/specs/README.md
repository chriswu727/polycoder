# Implementation Specs

Three documents that together form the implementation contract for V0.
When implementation begins, the code follows these specs; if a spec
turns out wrong, the spec is updated **before** the code.

| File | Scope | Approx LOC implication |
|------|-------|------------------------|
| [`providers.md`](./providers.md) | LLM provider abstraction, 5 V0 adapters, error taxonomy, streaming protocol, cost tracking | ~1500 src + ~1500 test |
| [`tools.md`](./tools.md) | Tool framework, 10 V0 tools, permission model | ~1500 src + ~1500 test |
| [`orchestrator.md`](./orchestrator.md) | Pipeline state machine, role invocation, conflict detection, re-prompt logic, memory updates | ~2000 src + ~1500 test |

## Reading order

1. **`providers.md`** first — the foundation everything else depends on
2. **`tools.md`** second — the verbs the system can do
3. **`orchestrator.md`** third — the brain that ties it all together

## Cross-references

- All three reference [`../decisions.md`](../decisions.md) ADRs
- All three reference the role contracts in [`../prompts/`](../prompts/)
- The orchestrator references the data model in [`../../SPEC.md`](../../SPEC.md) §5

## What's NOT in these specs

- **UI layer** (Electron + React + Tailwind components) — the spec
  for that lives in `SPEC.md` §6 and will be expanded in V0.1
  implementation as components are built. UI is leaf code; specifying
  it ahead of time has lower payoff than specifying foundational
  layers.
- **Secret store implementation** — covered briefly in `SPEC.md` §8;
  full integration spec written when implementation starts (depends
  on Electron's secure storage primitives, which are platform-specific
  and best validated against working code).
- **Build/packaging** (Mac DMG, Windows installer) — V1.0 task, spec
  written closer to release.

## Implementation status

All three specs are in **design phase**. No source code has been
written. See [`../../todo.md`](../../todo.md) for the build plan.
