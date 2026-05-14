// SQLite connection helper. Opens a database with the standard polycoder
// pragmas (WAL, foreign_keys ON), runs migrations, and returns a ready
// Database instance.

import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA_VERSION = 1

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Open a polycoder database and ensure migrations are up to date.
 *
 * @param dbPath  filesystem path, or ':memory:' for an in-memory DB
 *                (used in tests).
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  configureDatabase(db)
  runMigrations(db)
  recoverOrphanedIterations(db)
  return db
}

/**
 * Crash-recovery sweep. Any iteration left in 'running' status from a
 * prior process (Electron crash, kill -9, OS shutdown) is now stranded —
 * the AbortController and event bus that drove it are gone. Mark them
 * aborted so the UI doesn't show a perpetual spinner on app restart.
 */
function recoverOrphanedIterations(db: Database.Database): void {
  const now = Date.now()
  db.prepare(
    `UPDATE iterations
       SET status = 'aborted',
           traffic_light = COALESCE(traffic_light, 'red'),
           ended_at = COALESCE(ended_at, ?),
           duration_ms = COALESCE(duration_ms, ? - started_at)
     WHERE status = 'running'`,
  ).run(now, now)
}

export function configureDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -16000') // 16 MB
}

export function runMigrations(db: Database.Database): void {
  // Ensure the migrations table exists by running the v1 schema (idempotent).
  const v1 = loadSchemaSqlV1()
  db.exec(v1)

  // Insert version row if not present.
  const existing = db
    .prepare('SELECT version FROM schema_migrations WHERE version = ?')
    .get(SCHEMA_VERSION) as { version: number } | undefined

  if (!existing) {
    db.prepare(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    ).run(SCHEMA_VERSION, Date.now())
  }
}

export function getCurrentSchemaVersion(db: Database.Database): number {
  // If migrations table doesn't exist yet, return 0.
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get() as { name: string } | undefined
  if (!tableExists) return 0

  const row = db
    .prepare('SELECT MAX(version) as v FROM schema_migrations')
    .get() as { v: number | null }
  return row.v ?? 0
}

function loadSchemaSqlV1(): string {
  return readFileSync(join(__dirname, 'schema.sql'), 'utf8')
}
