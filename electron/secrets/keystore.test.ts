// Test the in-memory keystore (the OS-backed one is not unit-tested
// because keytar requires platform-specific runtime services that
// aren't available in CI). The InMemoryKeystore implements the same
// interface, so this verifies the contract.

import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  InMemoryKeystore,
  accountFor,
  parseAccount,
} from './keystore.js'

describe('InMemoryKeystore (KeyStore contract)', () => {
  let store: InMemoryKeystore

  beforeEach(() => {
    store = new InMemoryKeystore()
  })

  it('round-trips set / get / delete', async () => {
    const ws = randomUUID()
    const sec = randomUUID()
    expect(await store.getKey(ws, sec)).toBeNull()

    await store.setKey(ws, sec, 'sk-test-123')
    expect(await store.getKey(ws, sec)).toBe('sk-test-123')

    const removed = await store.deleteKey(ws, sec)
    expect(removed).toBe(true)
    expect(await store.getKey(ws, sec)).toBeNull()

    const removedAgain = await store.deleteKey(ws, sec)
    expect(removedAgain).toBe(false)
  })

  it('refuses to store an empty key', async () => {
    await expect(store.setKey(randomUUID(), randomUUID(), '')).rejects.toThrow()
  })

  it('isolates keys across (workspace, secret) tuples', async () => {
    const wsA = randomUUID()
    const wsB = randomUUID()
    const sec = randomUUID()
    await store.setKey(wsA, sec, 'key-A')
    await store.setKey(wsB, sec, 'key-B')

    expect(await store.getKey(wsA, sec)).toBe('key-A')
    expect(await store.getKey(wsB, sec)).toBe('key-B')

    await store.deleteKey(wsA, sec)
    expect(await store.getKey(wsA, sec)).toBeNull()
    expect(await store.getKey(wsB, sec)).toBe('key-B')
  })

  it('listAccounts returns all stored (workspace, secret) pairs', async () => {
    const ws = randomUUID()
    const sec1 = randomUUID()
    const sec2 = randomUUID()
    await store.setKey(ws, sec1, 'k1')
    await store.setKey(ws, sec2, 'k2')

    const accounts = await store.listAccounts()
    expect(accounts).toHaveLength(2)
    const ids = accounts.map((a) => a.secret_id).sort()
    expect(ids).toEqual([sec1, sec2].sort())
  })
})

describe('accountFor / parseAccount', () => {
  it('round-trips workspace + secret id through string form', () => {
    const ws = randomUUID()
    const sec = randomUUID()
    const account = accountFor(ws, sec)
    expect(account).toBe(`${ws}:${sec}`)

    const parsed = parseAccount(account)
    expect(parsed).toEqual({ workspace_id: ws, secret_id: sec })
  })

  it('parseAccount returns null on malformed input', () => {
    expect(parseAccount('no-colon')).toBeNull()
    expect(parseAccount(':')).toBeNull()
    expect(parseAccount('a:')).toBeNull()
    expect(parseAccount(':b')).toBeNull()
  })
})
