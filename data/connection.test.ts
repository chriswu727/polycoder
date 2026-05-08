import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  openDatabase,
  getCurrentSchemaVersion,
  SCHEMA_VERSION,
  runMigrations,
  configureDatabase,
} from './connection.js'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('connection.openDatabase', () => {
  let tmpDir: string
  let dbPath: string
  let db: Database.Database

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-conn-'))
    dbPath = join(tmpDir, 'test.db')
    db = openDatabase(dbPath)
  })

  afterEach(() => {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns a database with WAL journal mode', () => {
    const mode = db.pragma('journal_mode', { simple: true })
    expect(mode).toBe('wal')
  })

  it('has foreign keys enabled', () => {
    const fk = db.pragma('foreign_keys', { simple: true })
    expect(fk).toBe(1)
  })

  it('records the current schema version', () => {
    expect(getCurrentSchemaVersion(db)).toBe(SCHEMA_VERSION)
  })

  it('creates all expected tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const tableNames = tables.map((t) => t.name)

    expect(tableNames).toContain('workspaces')
    expect(tableNames).toContain('secrets')
    expect(tableNames).toContain('role_assignments')
    expect(tableNames).toContain('project_memory')
    expect(tableNames).toContain('iterations')
    expect(tableNames).toContain('cost_records')
    expect(tableNames).toContain('schema_migrations')
  })

  it('migration is idempotent (running twice does not error or duplicate)', () => {
    runMigrations(db)
    runMigrations(db)

    const versions = db
      .prepare('SELECT COUNT(*) as c FROM schema_migrations WHERE version = ?')
      .get(SCHEMA_VERSION) as { c: number }
    expect(versions.c).toBe(1)
  })

  it('cascade delete: deleting a workspace removes its secrets', () => {
    db.prepare(
      'INSERT INTO workspaces (id, name, workspace_root, ui_lang, preset, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('w1', 'test', '/tmp', 'zh-CN', 'custom', 0, 0)
    db.prepare(
      'INSERT INTO secrets (id, workspace_id, name, provider, available_models, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('s1', 'w1', 'k', 'deepseek', '[]', 0)

    db.prepare('DELETE FROM workspaces WHERE id = ?').run('w1')

    const remaining = db
      .prepare('SELECT COUNT(*) as c FROM secrets WHERE id = ?')
      .get('s1') as { c: number }
    expect(remaining.c).toBe(0)
  })
})

describe('getCurrentSchemaVersion', () => {
  it('returns 0 on a fresh, un-migrated database', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-fresh-'))
    const db = new Database(join(tmpDir, 'fresh.db'))
    configureDatabase(db)
    expect(getCurrentSchemaVersion(db)).toBe(0)
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
