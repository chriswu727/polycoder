// Source-of-truth for IPC channel names. Used by both main (handler
// registration) and preload (typed exposed API) so a typo can't
// silently break the bridge.

export const IPC_CHANNELS = {
  // Workspace
  WORKSPACE_CREATE: 'polycoder.workspace.create',
  WORKSPACE_LIST: 'polycoder.workspace.list',
  WORKSPACE_GET: 'polycoder.workspace.get',
  WORKSPACE_DELETE: 'polycoder.workspace.delete',
  WORKSPACE_RENAME: 'polycoder.workspace.rename',
  /** Open a native folder-picker dialog and return the chosen path. */
  WORKSPACE_PICK_FOLDER: 'polycoder.workspace.pickFolder',
  /** Boot (if needed) + point the preview HTTP server at this
   *  workspace, then return the URL the renderer should iframe. */
  WORKSPACE_PREVIEW_URL: 'polycoder.workspace.previewUrl',

  // Roles
  ROLE_SET_ASSIGNMENT: 'polycoder.role.setAssignment',
  ROLE_APPLY_PRESET: 'polycoder.role.applyPreset',

  // Pipeline / iterations
  ITERATION_START: 'polycoder.iteration.start',
  ITERATION_ABORT: 'polycoder.iteration.abort',
  ITERATION_LIST: 'polycoder.iteration.list',
  ITERATION_GET: 'polycoder.iteration.get',
  /** Single-Coder fast path. Skips the 8-role pipeline. */
  ITERATION_QUICK_EDIT: 'polycoder.iteration.quickEdit',
  /** Main → renderer push channel for pipeline events. */
  ITERATION_EVENT: 'polycoder.iteration.event',

  // Secrets
  SECRET_ADD: 'polycoder.secret.add',
  SECRET_LIST: 'polycoder.secret.list',
  SECRET_REMOVE: 'polycoder.secret.remove',
  SECRET_TEST: 'polycoder.secret.test',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
