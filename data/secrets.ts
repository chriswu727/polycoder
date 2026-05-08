// Secret CRUD that coordinates SQLite metadata with the OS keychain.
// The metadata-only fns live in `data/workspace.ts`; this module adds
// keystore-aware wrappers that the IPC layer calls.
//
// Invariant: the API key never lives in SQLite. Only the keystore
// holds plaintext.

import type Database from 'better-sqlite3'
import {
  createSecret as createSecretMeta,
  getSecret as getSecretMeta,
  listSecrets as listSecretsMeta,
  deleteSecret as deleteSecretMeta,
  updateSecretAfterTest,
  type CreateSecretInput,
} from './workspace.js'
import type {
  HydratedSecret,
  SecretMeta,
} from '@core/types/workspace.js'
import type { KeyStore } from '../electron/secrets/keystore.js'

// ─── Add / hydrate / remove ─────────────────────────────────────────

export type AddSecretInput = CreateSecretInput & {
  api_key: string
}

/**
 * Persist a new secret: metadata to SQLite, plaintext to keystore.
 * If keystore write fails, the metadata row is rolled back, so we
 * never have a "ghost" secret with no associated key.
 */
export async function addSecret(
  db: Database.Database,
  keystore: KeyStore,
  input: AddSecretInput,
): Promise<SecretMeta> {
  if (!input.api_key) throw new Error('addSecret: api_key is required')

  const meta = createSecretMeta(db, {
    workspace_id: input.workspace_id,
    name: input.name,
    provider: input.provider,
    ...(input.base_url !== undefined ? { base_url: input.base_url } : {}),
  })

  try {
    await keystore.setKey(input.workspace_id, meta.id, input.api_key)
  } catch (e) {
    // Roll back metadata so we don't leave a metadata row without a key.
    deleteSecretMeta(db, meta.id)
    throw e
  }
  return meta
}

/**
 * Fetch the hydrated form (metadata + plaintext key) used to build a
 * ModelProvider. Returns null if the metadata row is gone or the key
 * is not in the keystore.
 */
export async function getHydratedSecret(
  db: Database.Database,
  keystore: KeyStore,
  workspaceId: string,
  secretId: string,
): Promise<HydratedSecret | null> {
  const meta = getSecretMeta(db, secretId)
  if (!meta) return null
  const key = await keystore.getKey(workspaceId, secretId)
  if (key === null) return null
  return { ...meta, api_key: key }
}

/**
 * Remove a secret from both stores. Idempotent: if the row is gone
 * already, just cleans up the keychain entry (or vice versa).
 */
export async function removeSecret(
  db: Database.Database,
  keystore: KeyStore,
  workspaceId: string,
  secretId: string,
): Promise<void> {
  // Best-effort: try keystore first; if it fails we still remove
  // metadata. (Keystore failures are usually "not found", which is
  // fine.)
  try {
    await keystore.deleteKey(workspaceId, secretId)
  } catch {
    // ignore
  }
  deleteSecretMeta(db, secretId)
}

// ─── Re-exports for convenience ─────────────────────────────────────

export { listSecretsMeta as listSecrets, getSecretMeta as getSecretMetadata, updateSecretAfterTest }

// ─── Orphan cleanup ─────────────────────────────────────────────────

/**
 * Find keystore entries whose metadata rows are gone (e.g. after a
 * workspace deletion that didn't reach the keychain) and delete them.
 * Run periodically or on app start.
 */
export async function pruneOrphanedKeys(
  db: Database.Database,
  keystore: KeyStore,
): Promise<number> {
  const accounts = await keystore.listAccounts()
  if (accounts.length === 0) return 0

  // Find which secret_ids still exist in SQLite.
  const allSecretIds = new Set(
    (
      db
        .prepare('SELECT id FROM secrets')
        .all() as Array<{ id: string }>
    ).map((r) => r.id),
  )

  let removed = 0
  for (const a of accounts) {
    if (!allSecretIds.has(a.secret_id)) {
      await keystore.deleteKey(a.workspace_id, a.secret_id)
      removed++
    }
  }
  return removed
}
