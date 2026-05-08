// Source-of-truth for IPC channel names. Used by both main (handler
// registration) and preload (typed exposed API) so a typo can't
// silently break the bridge.

export const IPC_CHANNELS = {
  // Workspace
  WORKSPACE_CREATE: 'polycoder.workspace.create',
  WORKSPACE_LIST: 'polycoder.workspace.list',
  WORKSPACE_GET: 'polycoder.workspace.get',
  WORKSPACE_DELETE: 'polycoder.workspace.delete',

  // Secrets
  SECRET_ADD: 'polycoder.secret.add',
  SECRET_LIST: 'polycoder.secret.list',
  SECRET_REMOVE: 'polycoder.secret.remove',
  SECRET_TEST: 'polycoder.secret.test',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
