// testSecret — orchestrated "Test Connection" flow used by the
// Secrets UI. Hydrates a stored secret, builds a provider, calls
// provider.testConnection(), and on success persists the
// available_models + last_tested_at back to the metadata row.

import type Database from 'better-sqlite3'
import type { KeyStore } from '../electron/secrets/keystore.js'
import { getHydratedSecret, updateSecretAfterTest } from './secrets.js'
import { buildProvider, type BuildProviderOptions } from '@providers/registry.js'
import type { TestConnectionResult } from '@providers/ModelProvider.js'

export type TestSecretInput = {
  workspace_id: string
  secret_id: string
}

export async function testSecret(
  db: Database.Database,
  keystore: KeyStore,
  input: TestSecretInput,
  opts: BuildProviderOptions = {},
): Promise<TestConnectionResult> {
  const hydrated = await getHydratedSecret(
    db,
    keystore,
    input.workspace_id,
    input.secret_id,
  )
  if (!hydrated) {
    return {
      ok: false,
      reason: 'unknown',
      detail: 'Secret not found (metadata or key missing)',
    }
  }

  const provider = buildProvider(hydrated, opts)
  const result = await provider.testConnection()

  if (result.ok) {
    updateSecretAfterTest(
      db,
      input.secret_id,
      result.available_models.map((m) => m.id),
    )
  }

  return result
}
