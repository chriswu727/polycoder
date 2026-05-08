# Prompt Templates

This directory contains the V0.1 first-draft system prompt for each of
polycoder's 8 roles, plus a shared preamble.

## Files

| File | Role | Pipeline pos |
|------|------|--------------|
| [`00-shared-preamble.md`](./00-shared-preamble.md) | (universal) | prepended to every role |
| [`01-translator.md`](./01-translator.md) | Translator | 1 |
| [`02-designer.md`](./02-designer.md) | Designer | 2 |
| [`03-architect.md`](./03-architect.md) | Architect | 3 |
| [`04-coder.md`](./04-coder.md) | Coder | 4 |
| [`05-adversary.md`](./05-adversary.md) | Adversary | 5 (parallel) |
| [`06-long-term-critic.md`](./06-long-term-critic.md) | Long-term Critic | 6 (parallel) |
| [`07-test-runner.md`](./07-test-runner.md) | Test Runner | 7 (parallel) |
| [`08-communicator.md`](./08-communicator.md) | Communicator | 8 |

## How they get assembled at runtime

Each role's effective system prompt is composed from three pieces:

```
[1. Shared preamble §1-3] (from 00-shared-preamble.md)
[2. Role-specific static prefix] (sections 4-10 of the role's file)
[3. POLYCODER_PROMPT_BOUNDARY marker]
[4. Dynamic suffix] (rendered per-iteration with workspace state)
```

Pieces 1-3 form the cacheable static prefix (see ADR-009 in
`docs/decisions.md`). Piece 4 is appended at runtime with
iteration-specific data.

## Common structure of each role file

Every role file follows the same 10-section structure for consistency:

1. Identity ("You are the X")
2. Pipeline position
3. (Shared preamble prepended here)
4. Your role
5. Your input (XML envelope schema)
6. Your output (XML envelope schema)
7. Operating principles (numbered, role-specific)
8. Anti-patterns
9. Disagreement protocol
10. Examples (good + bad with commentary)

This shape is informed by Claude Code's tool prompt structure (see
`docs/claude-code-learnings.md` §4).

## Conventions

- All schemas use **JSON inside `<payload>` inside an XML `<role-output>`
  envelope**. See ADR-010.
- Token budgets are explicit per role. See each role's header block.
- Every role has at least one BAD example to anchor what NOT to do.
- Every role has explicit anti-patterns in section 8.
- The Architect, Adversary, and Communicator roles have stricter
  synthesis discipline rules — these are the roles where vague output
  most damages downstream quality.

## Versioning

Each role's prompt has a `Static prompt cache key` like
`polycoder/role/architect/v0.1`. When a role's prompt changes
substantively (not typo fixes), bump the version. This invalidates
prompt caches deliberately — existing workspaces continue with their
cached prefix until restart.

Version bumps should be paired with an ADR in `docs/decisions.md`
explaining what changed and why.

## Future work

- Translate role prompts to Chinese versions for users who want all
  internal output in Chinese (default is English internal; only the
  Communicator's user-facing text is Chinese).
- Add per-provider variants where models behave systematically
  differently (e.g. DeepSeek prefers more explicit output formatting
  hints than Claude).
- Validate each role prompt against its output schema using a small
  benchmark suite before any code is written.
