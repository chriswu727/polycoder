import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './connection.js'
import { createWorkspace } from './workspace.js'
import { addSecret, getSecretMetadata } from './secrets.js'
import { testSecret } from './secretsTest.js'
import { InMemoryKeystore } from '../electron/secrets/keystore.js'
import type { FetchImpl } from '@providers/httpClient.js'

let db: Database.Database
let tmpDir: string
let keystore: InMemoryKeystore

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'polycoder-test-secret-'))
  db = openDatabase(join(tmpDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeAnthropicSuccessFetch(): FetchImpl {
  return ((_input: string | URL | Request) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )) as FetchImpl
}

function makeAuthFailFetch(): FetchImpl {
  return ((_input: string | URL | Request) =>
    Promise.resolve(
      new Response(JSON.stringify({ error: 'invalid api key' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )) as FetchImpl
}

describe('testSecret', () => {
  it('returns ok and persists available_models on success', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const meta = await addSecret(db, keystore, {
      workspace_id: ws.id,
      name: 'k',
      provider: 'anthropic',
      api_key: 'sk-ant-test',
    })
    expect(meta.last_tested_at).toBeNull()
    expect(meta.available_models).toHaveLength(0)

    const result = await testSecret(
      db,
      keystore,
      { workspace_id: ws.id, secret_id: meta.id },
      { fetchImpl: makeAnthropicSuccessFetch() },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.available_models.length).toBeGreaterThan(0)
    }

    // Persisted updates.
    const after = getSecretMetadata(db, meta.id)
    expect(after?.last_tested_at).not.toBeNull()
    expect(after?.available_models.length).toBeGreaterThan(0)
  })

  it('returns failure on auth error and does NOT update last_tested_at', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const meta = await addSecret(db, keystore, {
      workspace_id: ws.id,
      name: 'bad-key',
      provider: 'anthropic',
      api_key: 'sk-ant-bad',
    })

    const result = await testSecret(
      db,
      keystore,
      { workspace_id: ws.id, secret_id: meta.id },
      { fetchImpl: makeAuthFailFetch() },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('auth_failed')
    }

    const after = getSecretMetadata(db, meta.id)
    expect(after?.last_tested_at).toBeNull()
    expect(after?.available_models).toHaveLength(0)
  })

  it('returns "Secret not found" if metadata missing', async () => {
    const ws = createWorkspace(db, { name: 'A', workspace_root: '/a' })
    const result = await testSecret(db, keystore, {
      workspace_id: ws.id,
      secret_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unknown')
      expect(result.detail).toMatch(/not found/i)
    }
  })
})
