// Electron preload script.
// Exposes a typed API surface to the renderer via contextBridge.
// Renderer NEVER sees plaintext API keys.

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from './ipc/channels.js'
import type {
  AddSecretRequest,
  AddSecretResponse,
  ListSecretsRequest,
  ListSecretsResponse,
  RemoveSecretRequest,
  RemoveSecretResponse,
  TestSecretRequest,
  TestSecretResponse,
} from './ipc/secretsHandlers.js'
import type {
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  ListWorkspacesResponse,
  GetWorkspaceRequest,
  GetWorkspaceResponse,
  DeleteWorkspaceRequest,
  DeleteWorkspaceResponse,
  RenameWorkspaceRequest,
  RenameWorkspaceResponse,
  SetRoleAssignmentRequest,
  SetRoleAssignmentResponse,
  ApplyPresetRequest,
  ApplyPresetResponse,
} from './ipc/workspaceHandlers.js'
import type {
  StartIterationRequest,
  StartIterationResponse,
  AbortIterationRequest,
  AbortIterationResponse,
  ListIterationsRequest,
  ListIterationsResponse,
  GetIterationRequest,
  GetIterationResponse,
  RendererPipelineEvent,
} from './ipc/pipelineHandlers.js'

const polycoderAPI = {
  version: '0.0.1',

  workspace: {
    create(req: CreateWorkspaceRequest): Promise<CreateWorkspaceResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CREATE, req) as Promise<CreateWorkspaceResponse>
    },
    list(): Promise<ListWorkspacesResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_LIST) as Promise<ListWorkspacesResponse>
    },
    get(req: GetWorkspaceRequest): Promise<GetWorkspaceResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET, req) as Promise<GetWorkspaceResponse>
    },
    delete(req: DeleteWorkspaceRequest): Promise<DeleteWorkspaceResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_DELETE, req) as Promise<DeleteWorkspaceResponse>
    },
    rename(req: RenameWorkspaceRequest): Promise<RenameWorkspaceResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_RENAME, req) as Promise<RenameWorkspaceResponse>
    },
    pickFolder(req?: { defaultPath?: string }): Promise<string | null> {
      return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_PICK_FOLDER, req) as Promise<string | null>
    },
    previewUrl(req: { workspace_id: string }): Promise<string | null> {
      return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_PREVIEW_URL, req) as Promise<string | null>
    },
  },

  roles: {
    setAssignment(req: SetRoleAssignmentRequest): Promise<SetRoleAssignmentResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.ROLE_SET_ASSIGNMENT, req) as Promise<SetRoleAssignmentResponse>
    },
    applyPreset(req: ApplyPresetRequest): Promise<ApplyPresetResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.ROLE_APPLY_PRESET, req) as Promise<ApplyPresetResponse>
    },
  },

  iteration: {
    start(req: StartIterationRequest): Promise<StartIterationResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.ITERATION_START, req) as Promise<StartIterationResponse>
    },
    abort(req: AbortIterationRequest): Promise<AbortIterationResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.ITERATION_ABORT, req) as Promise<AbortIterationResponse>
    },
    list(req: ListIterationsRequest): Promise<ListIterationsResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.ITERATION_LIST, req) as Promise<ListIterationsResponse>
    },
    get(req: GetIterationRequest): Promise<GetIterationResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.ITERATION_GET, req) as Promise<GetIterationResponse>
    },
    /**
     * Subscribe to streaming pipeline events. Returns an unsubscribe
     * function. Events are filtered renderer-side by workspace_id
     * (the iteration store handles that).
     */
    onEvent(callback: (event: RendererPipelineEvent) => void): () => void {
      const handler = (_e: unknown, event: RendererPipelineEvent) => callback(event)
      ipcRenderer.on(IPC_CHANNELS.ITERATION_EVENT, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.ITERATION_EVENT, handler)
      }
    },
  },

  secrets: {
    add(req: AddSecretRequest): Promise<AddSecretResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.SECRET_ADD, req) as Promise<AddSecretResponse>
    },
    list(req: ListSecretsRequest): Promise<ListSecretsResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.SECRET_LIST, req) as Promise<ListSecretsResponse>
    },
    remove(req: RemoveSecretRequest): Promise<RemoveSecretResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.SECRET_REMOVE, req) as Promise<RemoveSecretResponse>
    },
    test(req: TestSecretRequest): Promise<TestSecretResponse> {
      return ipcRenderer.invoke(IPC_CHANNELS.SECRET_TEST, req) as Promise<TestSecretResponse>
    },
  },

  // Native menu → renderer bridge. The main process sends commands
  // like 'newPrompt' / 'toggleTheme' over these channels in
  // response to the application menu.
  menu: {
    onCommand(callback: (cmd: 'newWorkspace' | 'newPrompt' | 'toggleTheme') => void): () => void {
      const make = (cmd: 'newWorkspace' | 'newPrompt' | 'toggleTheme') => (): void =>
        callback(cmd)
      const onNewWorkspace = make('newWorkspace')
      const onNewPrompt = make('newPrompt')
      const onToggleTheme = make('toggleTheme')
      ipcRenderer.on('polycoder.menu.newWorkspace', onNewWorkspace)
      ipcRenderer.on('polycoder.menu.newPrompt', onNewPrompt)
      ipcRenderer.on('polycoder.menu.toggleTheme', onToggleTheme)
      return () => {
        ipcRenderer.removeListener('polycoder.menu.newWorkspace', onNewWorkspace)
        ipcRenderer.removeListener('polycoder.menu.newPrompt', onNewPrompt)
        ipcRenderer.removeListener('polycoder.menu.toggleTheme', onToggleTheme)
      }
    },
  },
} as const

// V0.1.1 diagnostic: dump what we expose to a file so I can read
// it from the agent side (renderer console.log can't be tailed).
diagWritePreloadKeys(polycoderAPI)
contextBridge.exposeInMainWorld('polycoder', polycoderAPI)

function diagWritePreloadKeys(api: typeof polycoderAPI): void {
  // eslint-disable-next-line no-console
  console.log('[polycoder preload] exposing API. workspace keys:', Object.keys(api.workspace))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const electronRequire = (globalThis as any).require as
    | ((m: string) => unknown)
    | undefined
  if (!electronRequire) {
    // eslint-disable-next-line no-console
    console.error('[polycoder preload] no require available; sandbox blocking?')
    return
  }
  try {
    const fs = electronRequire('node:fs') as typeof import('node:fs')
    fs.writeFileSync(
      '/tmp/polycoder-preload-diag.json',
      JSON.stringify(
        {
          ts: new Date().toISOString(),
          workspaceKeys: Object.keys(api.workspace),
          rolesKeys: Object.keys(api.roles),
          iterationKeys: Object.keys(api.iteration),
          secretsKeys: Object.keys(api.secrets),
          electronVersion: process.versions.electron,
          nodeVersion: process.versions.node,
        },
        null,
        2,
      ),
    )
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[polycoder preload] could not write diag:', e)
  }
}

export type PolycoderAPI = typeof polycoderAPI

declare global {
  interface Window {
    polycoder: PolycoderAPI
  }
}
