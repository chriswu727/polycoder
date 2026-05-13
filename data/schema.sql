-- polycoder SQLite schema, version 1.
-- Applied by data/migrate.ts. See SPEC.md §5 and docs/specs/orchestrator.md.
--
-- Conventions:
--   * Timestamps stored as INTEGER milliseconds since epoch (Date.now()).
--   * UUIDs stored as TEXT (36-char canonical form).
--   * Boolean stored as INTEGER (0/1).
--   * Foreign keys are declared and enforced (PRAGMA foreign_keys = ON).
--   * JSON columns store role envelopes / conflicts as TEXT (json_*) blobs.

-- ─── Migration tracking ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- ─── Workspaces ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspaces (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  workspace_root  TEXT NOT NULL,
  ui_lang         TEXT NOT NULL DEFAULT 'zh-CN',
  preset          TEXT NOT NULL DEFAULT 'custom',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_updated_at
  ON workspaces(updated_at DESC);

-- ─── Secrets ────────────────────────────────────────────────────────
-- The api_key itself is stored in the OS keychain (Layer D), keyed by
-- secret.id. This row holds metadata only.

CREATE TABLE IF NOT EXISTS secrets (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  provider            TEXT NOT NULL,
  base_url            TEXT,
  available_models    TEXT NOT NULL DEFAULT '[]',  -- JSON array
  last_tested_at      INTEGER,
  created_at          INTEGER NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_secrets_workspace
  ON secrets(workspace_id);

-- ─── Role assignments ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS role_assignments (
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role                    TEXT NOT NULL,
  secret_id               TEXT REFERENCES secrets(id) ON DELETE SET NULL,
  model_id                TEXT,
  fallback_secret_id      TEXT REFERENCES secrets(id) ON DELETE SET NULL,
  fallback_model_id       TEXT,
  custom_prompt_override  TEXT,
  PRIMARY KEY (workspace_id, role)
);

-- ─── Project memory ─────────────────────────────────────────────────
-- Stored as a single JSON blob per workspace. Updated atomically by
-- updateProjectMemory(); much simpler than normalizing into 5 tables
-- given the read pattern (always full snapshot).

CREATE TABLE IF NOT EXISTS project_memory (
  workspace_id    TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  memory_json     TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ─── Iterations ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS iterations (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  iteration_number    INTEGER NOT NULL,
  user_prompt         TEXT NOT NULL,
  status              TEXT NOT NULL,
  traffic_light       TEXT,
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER,
  duration_ms         INTEGER,
  total_cost_usd      REAL,
  files_changed       TEXT NOT NULL DEFAULT '[]',
  role_outputs_json   TEXT NOT NULL DEFAULT '{}',
  conflicts_json      TEXT NOT NULL DEFAULT '[]',
  UNIQUE(workspace_id, iteration_number)
);

CREATE INDEX IF NOT EXISTS idx_iterations_workspace_started
  ON iterations(workspace_id, started_at DESC);

-- ─── Iteration messages ─────────────────────────────────────────────
-- One row per LLM message produced during an iteration. Captured for
-- Quick Edit follow-up / conversation continuation — a follow-up
-- reuses this history as the initial conversation so the model has
-- full context (prior reads, prior edits, prior reasoning) without
-- having to re-discover.
--
-- For full pipeline iterations we don't currently persist messages;
-- iteration_messages is empty for those rows. The continuation
-- feature is scoped to Quick Edit for now.

CREATE TABLE IF NOT EXISTS iteration_messages (
  iteration_id     TEXT NOT NULL REFERENCES iterations(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  role             TEXT NOT NULL,
  content          TEXT NOT NULL,
  tool_calls_json  TEXT,
  tool_call_id     TEXT,
  PRIMARY KEY (iteration_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_iteration_messages
  ON iteration_messages(iteration_id, seq);

-- ─── Cost records ───────────────────────────────────────────────────
-- One row per role invocation. Aggregated for per-iteration and
-- per-workspace totals; raw rows kept for audit.

CREATE TABLE IF NOT EXISTS cost_records (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  iteration_id            TEXT NOT NULL REFERENCES iterations(id) ON DELETE CASCADE,
  role                    TEXT NOT NULL,
  provider                TEXT NOT NULL,
  model                   TEXT NOT NULL,
  input_tokens            INTEGER NOT NULL,
  output_tokens           INTEGER NOT NULL,
  cached_input_tokens     INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd      REAL NOT NULL,
  duration_ms             INTEGER NOT NULL,
  recorded_at             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cost_records_workspace
  ON cost_records(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cost_records_iteration
  ON cost_records(iteration_id);
