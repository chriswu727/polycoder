// Tests for the pure handler functions. Decoupled from Electron's
// ipcMain — we just call the handlers directly with mocked deps.
// (Electron's invoke/handle plumbing is trivial; testing the handler
// logic is what matters.)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../data/connection.js'
import { createWorkspace } from '../../data/workspace.js'
import { InMemoryKeystore } from '../secrets/keystore.js'
import {
  handleAddSecret,
  handleListSecrets,
  handleRemoveSecret,
} from './secretsHandlers.js'

let db: Database.Database
let tmpDir: string
let keystore: InMemoryKeystore

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-ipc-'))
  db = openDatabase(join(tmpDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('handleAddSecret', () => {
  it('returns ok with metadata on success', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const result = await handleAddSecret(
      { db, keystore },
      {
        workspace_id: ws.id,
        name: 'my-deepseek',
        provider: 'deepseek',
        api_key: 'sk-test',
      },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.secret.name).toBe('my-deepseek')
      expect(result.secret.provider).toBe('deepseek')
    }
  })

  it('returns ok:false on empty api_key', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const result = await handleAddSecret(
      { db, keystore },
      {
        workspace_id: ws.id,
        name: 'k',
        provider: 'glm',
        api_key: '',
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/api_key/i)
    }
  })

  it('does not echo plaintext api_key in response', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const result = await handleAddSecret(
      { db, keystore },
      {
        workspace_id: ws.id,
        name: 'k',
        provider: 'qwen',
        api_key: 'sk-secret-must-not-leak',
      },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('sk-secret-must-not-leak')
    }
  })
})

describe('handleListSecrets', () => {
  it('returns metadata only', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    await handleAddSecret(
      { db, keystore },
      {
        workspace_id: ws.id,
        name: 'a',
        provider: 'deepseek',
        api_key: 'sk-1',
      },
    )
    await handleAddSecret(
      { db, keystore },
      {
        workspace_id: ws.id,
        name: 'b',
        provider: 'qwen',
        api_key: 'sk-2',
      },
    )

    const list = handleListSecrets({ db, keystore }, { workspace_id: ws.id })
    expect(list).toHaveLength(2)
    // Confirm the api_key is NOT a property of the returned shape.
    const serialized = JSON.stringify(list)
    expect(serialized).not.toContain('sk-1')
    expect(serialized).not.toContain('sk-2')
  })
})

describe('handleRemoveSecret', () => {
  it('removes from both stores', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const added = await handleAddSecret(
      { db, keystore },
      {
        workspace_id: ws.id,
        name: 'k',
        provider: 'glm',
        api_key: 'sk',
      },
    )
    expect(added.ok).toBe(true)
    if (!added.ok) return

    await handleRemoveSecret(
      { db, keystore },
      { workspace_id: ws.id, secret_id: added.secret.id },
    )

    expect(handleListSecrets({ db, keystore }, { workspace_id: ws.id })).toHaveLength(0)
    expect(await keystore.getKey(ws.id, added.secret.id)).toBeNull()
  })
})
