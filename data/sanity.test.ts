// SQLite smoke test — proves better-sqlite3 is wired and the native
// module loads in the test environment. Real data layer (workspaces,
// project memory, iteration history) lands in Layer B.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('better-sqlite3 sanity', () => {
  let tmpDir: string
  let dbPath: string
  let db: Database.Database

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-sqlite-'))
    dbPath = join(tmpDir, 'test.db')
    db = new Database(dbPath)
  })

  afterEach(() => {
    db.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('CREATE TABLE + INSERT + SELECT round-trip', () => {
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)

    const insert = db.prepare(
      'INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)',
    )
    insert.run('w-1', 'My First Workspace', Date.now())

    const row = db
      .prepare('SELECT id, name FROM workspaces WHERE id = ?')
      .get('w-1') as { id: string; name: string } | undefined

    expect(row).toBeDefined()
    expect(row?.id).toBe('w-1')
    expect(row?.name).toBe('My First Workspace')
  })

  it('WAL mode can be enabled (used in real workspace DB)', () => {
    db.pragma('journal_mode = WAL')
    const mode = db.pragma('journal_mode', { simple: true })
    expect(mode).toBe('wal')
  })

  it('foreign key constraints enforce when enabled', () => {
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE parent (id TEXT PRIMARY KEY);
      CREATE TABLE child (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE
      );
    `)

    expect(() => {
      db.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run(
        'c1',
        'nonexistent-parent',
      )
    }).toThrow(/FOREIGN KEY/i)
  })
})
