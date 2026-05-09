# polycoder frontend design brief

This is the requirements brief for the polycoder desktop-app
frontend (V0.2+ refresh). Hand it to a design tool / designer
and let them propose a visual system. Do **not** copy Lovable;
do borrow its vibe-coder-friendly philosophy.

---

## 1. Who this is for

A **vibe coder** — someone with an idea but limited or no coding
ability. They want a finished app from a description, not a
walkthrough of how it was built. Treat them like a creative
client hiring a small studio. Polished, calm, encouraging. Not a
developer dashboard.

## 2. What polycoder does (so the UI makes sense)

The user types a natural-language prompt. Behind the scenes,
**8 specialized AI roles** cooperate to design and build the app:

1. Translates the user's idea into a structured spec
2. Sketches a UI/UX layout
3. Plans the architecture
4. Writes the code
5. Adversarially reviews the code for bugs
6. Reviews long-term code health
7. Writes and runs tests
8. Synthesizes a friendly user-facing summary + traffic-light
   verdict

Each role can use a different LLM provider/model. The user
brings their own API keys (BYOK). One iteration takes 5-15
minutes.

The user iterates: they send another prompt to add or change
something, the same 8 roles run again on top of the existing
codebase. Files persist across iterations on the user's local
filesystem.

## 3. Screens / states the UI must cover

Design a unified surface, not necessarily separate "pages." Each
of these is a state that needs visual treatment:

### 3.1 First-run, no workspace yet
- The user has just opened polycoder. Nothing has been set up.
- Need: invite them to name a project + pick a folder on disk
  for the project to live in (folder picker is a native dialog).
- Constraint: the folder MUST be on their local disk (not cloud).
  Communicate this without using the words "absolute path."

### 3.2 First-run inside a fresh workspace, no API key yet
- The user has a workspace but no model credentials, so nothing
  can run yet.
- Need: prompt them to add an API key from one of the supported
  providers (DeepSeek, Qwen, GLM/Zhipu, Anthropic, OpenAI-compat
  endpoints). Make this feel safe, not scary — explain that the
  key is stored in the OS keychain and never sent anywhere except
  the provider.
- After a key is added, they can either tap a **one-click team
  preset** ("Budget", "China-Pro", "Mixed") or skip into the
  chat with a default preset auto-applied.

### 3.3 Workspace ready, idle (no iteration running)
- Their workspace exists, has at least one key, has team
  assignments. The chat is the focus.
- Need: a chat input where they describe what they want.
  Optional: example prompts ("a simple to-do list", "a SaaS
  landing page", "a sales dashboard") to lower the cold-start
  barrier.

### 3.4 Iteration in progress
- After the user sends a prompt, the 8 roles run sequentially
  (the first 4) then in parallel (3 reviewers) then a final
  Communicator. The whole thing takes minutes, not seconds.
- Need: ambient feedback that work is happening. A simple
  "loading spinner" is unacceptable for a 5-minute wait.
- Concrete: show role-by-role progress with a friendly,
  non-technical label per role. Internal role IDs are
  `translator / designer / architect / coder / adversary /
  long_term_critic / test_runner / communicator`. The UI labels
  for vibe coders are:
  - "Understanding your idea"
  - "Sketching the layout"
  - "Planning the structure"
  - "Writing your app"
  - "Double-checking"
  - "Reviewing"
  - "Testing"
  - "Wrapping up"
- Each role has a status: pending / running / completed / failed.
- Show cumulative cost incrementally (e.g., "$0.03 so far").
- The user should be able to abort.

### 3.5 Iteration completed
The result has these pieces, all of which must be readable at a
glance and explorable in detail:

- **Traffic light verdict**: green / yellow / red (Communicator
  decides). Green = clean. Yellow = built but with notes. Red =
  something bad happened — usually means user input is needed.
- **User-facing prose summary** from Communicator (a paragraph
  or two of natural language).
- **Disagreement cards** (only when present): when roles
  disagreed about something (e.g., Adversary wants more error
  handling, Coder thinks it's overkill), show a card per
  disagreement with each role's stance, what action the user
  should take, and what happens if they skip. Vibe coders should
  feel like they're getting a candid second opinion from the
  team, not blamed for a bug.
- **Files changed**: a list of files the iteration created or
  modified. Probably collapsible — most users won't read code,
  some power users will.
- **What to do next**: 0-N suggestions from Communicator with
  priority (`must` / `recommended` / `optional`).
- **Visual preview** (if possible at this V): an iframe-style
  embed of the iteration's output. The workspace contains an
  `index.html` (and assets); render it inline so the user sees
  their app immediately. This is the single biggest credibility
  upgrade Lovable has over polycoder right now.
- **Cost + duration footer**: small, secondary, but present.

### 3.6 Iteration failed
- Sometimes a role can't produce a valid response, or an API
  call fails. Show this empathetically, not as a stack trace.
- Internal failure codes the orchestrator emits:
  `envelope_parse_exhausted`, `payload_validation_exhausted`,
  `tool_loop_budget_exceeded`, `provider_error`, `aborted`,
  `role_max_attempts_exceeded`. **Translate each into one
  sentence of plain English** describing what happened, which
  step failed (in the friendly role names), and what the user
  could try next. Keep the raw error code accessible behind a
  "Technical details" disclosure for power users.

### 3.7 Settings
Two things to configure:

- **Secrets**: list of API keys per provider, with affordances
  to add / test / remove. Keys are stored in OS keychain;
  surface that fact for trust.
- **Team configuration**: per-role provider+model assignment,
  with the three one-click presets prominent. This is the most
  technical screen — it's OK to feel a little more "settings
  panel" here. Power users will live in this; vibe coders will
  use a preset and never come back. Consider hiding this behind
  an "Advanced" disclosure when a preset has been applied.

### 3.8 Multi-workspace
- A user may have several projects (workspaces) over time. Need
  a way to switch between them and create new ones from anywhere
  in the app (probably top-bar dropdown or sidebar).
- Each workspace has its own iteration history.

## 4. Iteration history (per workspace)

Each iteration's metadata is persisted: prompt, traffic light,
duration, cost, role outputs, files changed. The UI should let
the user scroll back through history (e.g., a sidebar list).
Clicking an old iteration shows the same iteration-result view
as if it just happened. This is how the user "sees the journey"
of their project.

## 5. UX qualities that matter

These are the felt qualities the design should aim for. They
matter more than any specific component choice:

- **Calm, encouraging, never blames the user.** A vibe coder's
  failure mode is to feel "I'm too dumb for this." UI copy +
  visual hierarchy must lean against that.
- **Honest about progress, not performative.** A 5-minute wait
  is real. The UI should show real micro-progress (a role
  finished, a file was written, costs accrued) so the wait
  doesn't feel infinite. Don't fake spinners.
- **Trust through transparency**: when roles disagree, that's a
  feature, not a bug. Surface it as "your team had a quick
  discussion" framing — the disagreement cards are the
  centerpiece of polycoder's differentiator.
- **Cheap to undo**: vibe coders are scared to break things. The
  UI should make it obvious that an iteration just adds a new
  layer; previous state is preserved; nothing is destroyed.
- **Local-first, but doesn't shove it in your face**: the user's
  workspace is on their disk. That's a strength, but the UI
  shouldn't talk in filesystem language ("absolute path",
  "directory") — it should talk in product language ("your
  project", "where to put your project").
- **Inspired by Lovable's visual confidence + immediate preview,
  but not a clone**: Lovable establishes credibility with a
  polished chat UI + always-visible app preview. polycoder
  should match that confidence with its own visual identity.
  Don't borrow Lovable's specific colors, typography, layout —
  borrow the **emotional posture**: "This software knows what
  it's doing and treats you like an adult."

## 6. Constraints

- **Desktop app via Electron.** Window size is whatever the user
  drags it to; assume 1280×800 default but support 960×600
  minimum.
- **Native macOS** for V0.1; Windows + Linux later. macOS
  conventions (window controls, font, system colors) should feel
  natural.
- **No internet required for the chrome of the app itself** — UI
  assets must be locally bundled. Outbound network only happens
  on the user's behalf when calling LLM providers.
- **Light + dark modes**: nice to have, not required for V0.2.
- **Internationalization**: Chinese-language UI is the secondary
  audience (polycoder targets the Chinese market). Don't bake
  English-only copy patterns into the design (e.g., button
  widths shouldn't break if labels translate to longer Chinese).
- **No external chart libraries unless absolutely necessary** —
  keep the bundle modest. Status indicators, progress bars,
  badges are all hand-rolled.

## 7. What to leave OPEN to the designer

- Color palette + brand identity
- Typography
- Component library / component vocabulary
- Specific layout proportions and grid choices
- Iconography (we currently use lucide-react icons; designer can
  propose a different set)
- Empty states' visual treatment
- Animation language and motion design
- Whether to use sidebars vs top tabs vs other navigation models
- Chat bubble vs threaded vs other messaging patterns
- Whether the iteration-result view is a panel, a modal, a
  full-screen takeover, or inline

The designer should propose a coherent visual system; we'll
adopt it as long as it satisfies §3-§5.

## 8. Out of scope (don't design these for V0.2)

- Onboarding tutorial / interactive walkthrough
- Account / login / cloud sync (polycoder is local-first BYOK)
- Pricing / billing screens
- Marketing site (this is the in-app UX)
- Mobile

## 9. Reference data the design should bake against

Real polycoder output today (V0.1):

- Iteration-result view from one real run (`coder-only`,
  todo-iter05): traffic light yellow, 1 file changed
  (index.html, ~6KB), 5-iteration cumulative todo app with
  categories + bulk actions + due dates. Worked end-to-end.
- One real "red" verdict from polycoder-full dashboard/iter03:
  Coder hallucinated "no architect guidance received"
  (Architect actually provided it), Communicator caught the
  contradiction and went red. Designer should include a wireframe
  of how a "red" iteration would look and how it would invite the
  user to retry vs ask for help.
- Cost numbers: typical iter $0.10-0.30; one observed outlier
  $3.75 (since fixed). Show cost without scaring the user.

## 10. Deliverables expected back

- Visual system: type scale, color tokens, spacing scale,
  component primitives.
- Screen mocks for at least: §3.1, §3.3, §3.4, §3.5, §3.6, §3.7
  (Settings → Secrets and Settings → Team).
- Disagreement card variants (1-stance, 2-stance, 3-stance) —
  this is polycoder's signature element.
- A "before / after" of the current polycoder UI vs the proposed
  design, so we can see exactly which axes shifted.

That's it. Surprise us.
