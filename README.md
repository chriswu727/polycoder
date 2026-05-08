# polycoder

Multi-model AI coding agent for vibe coders. Optimized for **MVP → production
evolution**, not first-prompt magic.

> Working name. Final name TBD.

## Status

Design phase. No implementation yet.
See [`SPEC.md`](./SPEC.md) for the full design specification.

## Thesis

Existing vibe-coding tools (Lovable, Bolt, v0, Cursor Composer, Replit Agent,
Devin) optimize for the first prompt's magic. The apps they produce reliably
break by the 5th–7th iteration: no architectural memory, no enforced tests,
no refactoring pressure. Tech debt rises monotonically until the app is
unmaintainable.

This is structural, not a prompt-engineering problem. Single-model systems
can't escape it.

`polycoder` addresses this with **multi-model collaboration**: 8 cognitive
roles, each backed by a user-chosen model (DeepSeek, Qwen, GLM, Claude,
GPT, etc.), with **selective transparency** on disagreements between roles.

The product thesis in one line:

> *Lovable builds your MVP. We build your MVP so it can grow into a real product.*

## Why now

Target market: **Chinese-market vibe coders**.

- Lovable / Bolt / v0 / Cursor with Claude all unavailable or unreliable in China
- Domestic alternatives target developers, not non-coders
- Domestic LLMs (DeepSeek, Qwen, GLM) are 10–50× cheaper than Western counterparts
- **Multi-model adversarial review is economically viable in China** in a way
  it isn't in the West — 4–5 domestic models cost less than one Claude Sonnet call

## Core architecture (one paragraph)

Eight cognitive roles — Translator, Designer, Architect, Coder, Adversary,
Long-term Critic, Test Runner, Communicator — orchestrated as a pipeline.
Users plug in their own API keys (BYOK) and assign each role to a specific
model. Disagreements between roles are surfaced to the user rather than
internally resolved. Project memory persists across iterations; the
Architect role enforces cross-prompt pattern consistency. See
[`SPEC.md`](./SPEC.md) for full detail.

## Documents

- [`SPEC.md`](./SPEC.md) — full design specification
- [`docs/decisions.md`](./docs/decisions.md) — architecture decision log

## License

TBD (likely MIT or Apache-2.0).
