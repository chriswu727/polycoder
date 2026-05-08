import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './connection.js'
import { createWorkspace } from './workspace.js'
import {
  addSecret,
  getHydratedSecret,
  removeSecret,
  pruneOrphanedKeys,
  listSecrets,
} from './secrets.js'
import { InMemoryKeystore } from '../electron/secrets/keystore.js'

let db: Database.Database
let tmpDir: string
let keystore: InMemoryKeystore

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-secrets-'))
  db = openDatabase(join(tmpDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('addSecret', () => {
  it('writes metadata + key together', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const meta = await addSecret(db, keystore, {
      workspace_id: ws.id,
      name: 'my-deepseek',
      provider: 'deepseek',
      api_key: 'sk-test-123',
    })

    expect(meta.name).toBe('my-deepseek')
    expect(meta.provider).toBe('deepseek')

    // Key in keystore.
    const stored = await keystore.getKey(ws.id, meta.id)
    expect(stored).toBe('sk-test-123')

    // Metadata in SQLite.
    expect(listSecrets(db, ws.id)).toHaveLength(1)
  })

  it('rejects empty api_key', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    await expect(
      addSecret(db, keystore, {
        workspace_id: ws.id,
        name: 'k',
        provider: 'deepseek',
        api_key: '',
      }),
    ).rejects.toThrow()
  })

  it('rolls back metadata when keystore write fails', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })

    // Force a keystore failure by replacing setKey.
    const failingKeystore = new InMemoryKeystore()
    failingKeystore.setKey = async () => {
      throw new Error('simulated keychain failure')
    }

    await expect(
      addSecret(db, failingKeystore, {
        workspace_id: ws.id,
        name: 'k',
        provider: 'deepseek',
        api_key: 'sk-x',
      }),
    ).rejects.toThrow(/simulated keychain failure/)

    // Metadata should NOT exist.
    expect(listSecrets(db, ws.id)).toHaveLength(0)
  })
})

describe('getHydratedSecret', () => {
  it('returns metadata + api_key for a stored secret', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const meta = await addSecret(db, keystore, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'qwen',
      api_key: 'sk-qwen',
    })

    const hydrated = await getHydratedSecret(db, keystore, ws.id, meta.id)
    expect(hydrated).not.toBeNull()
    expect(hydrated?.api_key).toBe('sk-qwen')
    expect(hydrated?.provider).toBe('qwen')
  })

  it('returns null when metadata row is missing', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const result = await getHydratedSecret(
      db,
      keystore,
      ws.id,
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result).toBeNull()
  })

  it('returns null when keystore is missing the key', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const meta = await addSecret(db, keystore, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'glm',
      api_key: 'k',
    })
    // Sneakily delete from the keystore, leaving metadata orphaned.
    await keystore.deleteKey(ws.id, meta.id)

    const result = await getHydratedSecret(db, keystore, ws.id, meta.id)
    expect(result).toBeNull()
  })
})

describe('removeSecret', () => {
  it('removes from both stores', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const meta = await addSecret(db, keystore, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'glm',
      api_key: 'sk-x',
    })

    await removeSecret(db, keystore, ws.id, meta.id)

    expect(listSecrets(db, ws.id)).toHaveLength(0)
    expect(await keystore.getKey(ws.id, meta.id)).toBeNull()
  })

  it('is idempotent on missing entries', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    await expect(
      removeSecret(db, keystore, ws.id, '00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeUndefined()
  })
})

describe('pruneOrphanedKeys', () => {
  it('removes keystore entries with no SQLite row', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const meta = await addSecret(db, keystore, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'glm',
      api_key: 'sk-x',
    })

    // Simulate inconsistency: SQLite row gone, key remains.
    db.prepare('DELETE FROM secrets WHERE id = ?').run(meta.id)
    expect(await keystore.getKey(ws.id, meta.id)).toBe('sk-x')

    const removed = await pruneOrphanedKeys(db, keystore)
    expect(removed).toBe(1)
    expect(await keystore.getKey(ws.id, meta.id)).toBeNull()
  })

  it('returns 0 when keystore and SQLite are in sync', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    await addSecret(db, keystore, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'glm',
      api_key: 'sk-x',
    })
    expect(await pruneOrphanedKeys(db, keystore)).toBe(0)
  })
})
