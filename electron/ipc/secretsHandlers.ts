// Main-side IPC handlers for secret operations. Renderer never sees
// plaintext keys — handler boundary is the trust boundary.
//
// Wired up from electron/main.ts at app startup. The handler module
// is decoupled from Electron at the type level so we can test the
// pure handler logic without spawning a window.

import type Database from 'better-sqlite3'
import type { KeyStore } from '../secrets/keystore.js'
import {
  addSecret,
  removeSecret,
  listSecrets,
} from '../../data/secrets.js'
import { testSecret } from '../../data/secretsTest.js'
import type {
  ProviderId,
  SecretMeta,
} from '@core/types/workspace.js'
import type { TestConnectionResult } from '@providers/ModelProvider.js'

// ─── Request / response shapes (validated at the handler boundary) ──

export type AddSecretRequest = {
  workspace_id: string
  name: string
  provider: ProviderId
  base_url?: string
  api_key: string
}

export type AddSecretResponse = {
  ok: true
  secret: SecretMeta
} | {
  ok: false
  error: string
}

export type ListSecretsRequest = { workspace_id: string }
export type ListSecretsResponse = SecretMeta[]

export type RemoveSecretRequest = {
  workspace_id: string
  secret_id: string
}
export type RemoveSecretResponse = { ok: true }

export type TestSecretRequest = {
  workspace_id: string
  secret_id: string
}
export type TestSecretResponse = TestConnectionResult

// ─── Pure handler functions (testable without Electron) ─────────────

export type SecretsHandlerDeps = {
  db: Database.Database
  keystore: KeyStore
}

export async function handleAddSecret(
  deps: SecretsHandlerDeps,
  req: AddSecretRequest,
): Promise<AddSecretResponse> {
  try {
    const secret = await addSecret(deps.db, deps.keystore, {
      workspace_id: req.workspace_id,
      name: req.name,
      provider: req.provider,
      ...(req.base_url !== undefined ? { base_url: req.base_url } : {}),
      api_key: req.api_key,
    })
    return { ok: true, secret }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function handleListSecrets(
  deps: SecretsHandlerDeps,
  req: ListSecretsRequest,
): ListSecretsResponse {
  return listSecrets(deps.db, req.workspace_id)
}

export async function handleRemoveSecret(
  deps: SecretsHandlerDeps,
  req: RemoveSecretRequest,
): Promise<RemoveSecretResponse> {
  await removeSecret(deps.db, deps.keystore, req.workspace_id, req.secret_id)
  return { ok: true }
}

export async function handleTestSecret(
  deps: SecretsHandlerDeps,
  req: TestSecretRequest,
): Promise<TestSecretResponse> {
  return testSecret(deps.db, deps.keystore, req)
}
