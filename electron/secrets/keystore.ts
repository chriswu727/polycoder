// OS keychain abstraction. Uses keytar to talk to:
//   * macOS Keychain Services
//   * Windows Credential Manager
//   * Linux Secret Service (libsecret)
//
// API keys never live in our SQLite database — only here. The SQLite
// `secrets` table holds metadata (name, provider, available_models)
// and references the keychain entry by composite account ID.
//
// See SPEC.md §8 and ADR-005.

import keytar from 'keytar'

/**
 * The service name used in the keychain. All polycoder secrets share
 * this service; entries are distinguished by `account` (a composite
 * of workspace_id + secret_id, so secrets from different workspaces
 * never collide and deleting a workspace can clean its keys).
 */
export const KEYTAR_SERVICE = 'polycoder'

/**
 * Build the keychain account string from workspace + secret id.
 * Format: `<workspace_id>:<secret_id>`. Both are UUIDs, so the
 * delimiter is unambiguous.
 */
export function accountFor(workspaceId: string, secretId: string): string {
  return `${workspaceId}:${secretId}`
}

/**
 * Reverse: parse an account string back to its parts. Returns null
 * on malformed input.
 */
export function parseAccount(
  account: string,
): { workspace_id: string; secret_id: string } | null {
  const parts = account.split(':')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { workspace_id: parts[0], secret_id: parts[1] }
}

// ─── KeyStore interface (test seam) ─────────────────────────────────

/**
 * The keystore operations polycoder needs. Implemented by the real
 * keytar-backed `OsKeystore` in production, and by `InMemoryKeystore`
 * in tests where the OS keychain is unavailable / undesirable.
 */
export interface KeyStore {
  setKey(workspaceId: string, secretId: string, apiKey: string): Promise<void>
  getKey(workspaceId: string, secretId: string): Promise<string | null>
  deleteKey(workspaceId: string, secretId: string): Promise<boolean>
  /** List all (workspace, secret) account ids. Used for orphan cleanup. */
  listAccounts(): Promise<Array<{ workspace_id: string; secret_id: string }>>
}

// ─── Real OS-backed implementation ──────────────────────────────────

export class OsKeystore implements KeyStore {
  async setKey(
    workspaceId: string,
    secretId: string,
    apiKey: string,
  ): Promise<void> {
    if (!apiKey) throw new Error('Refusing to store empty key')
    await keytar.setPassword(KEYTAR_SERVICE, accountFor(workspaceId, secretId), apiKey)
  }

  async getKey(workspaceId: string, secretId: string): Promise<string | null> {
    return keytar.getPassword(KEYTAR_SERVICE, accountFor(workspaceId, secretId))
  }

  async deleteKey(workspaceId: string, secretId: string): Promise<boolean> {
    return keytar.deletePassword(KEYTAR_SERVICE, accountFor(workspaceId, secretId))
  }

  async listAccounts(): Promise<Array<{ workspace_id: string; secret_id: string }>> {
    const all = await keytar.findCredentials(KEYTAR_SERVICE)
    return all
      .map((c) => parseAccount(c.account))
      .filter((p): p is { workspace_id: string; secret_id: string } => p !== null)
  }
}

// ─── In-memory test implementation ──────────────────────────────────

export class InMemoryKeystore implements KeyStore {
  private store = new Map<string, string>()

  async setKey(
    workspaceId: string,
    secretId: string,
    apiKey: string,
  ): Promise<void> {
    if (!apiKey) throw new Error('Refusing to store empty key')
    this.store.set(accountFor(workspaceId, secretId), apiKey)
  }

  async getKey(workspaceId: string, secretId: string): Promise<string | null> {
    return this.store.get(accountFor(workspaceId, secretId)) ?? null
  }

  async deleteKey(workspaceId: string, secretId: string): Promise<boolean> {
    return this.store.delete(accountFor(workspaceId, secretId))
  }

  async listAccounts(): Promise<Array<{ workspace_id: string; secret_id: string }>> {
    return [...this.store.keys()]
      .map(parseAccount)
      .filter((p): p is { workspace_id: string; secret_id: string } => p !== null)
  }
}
