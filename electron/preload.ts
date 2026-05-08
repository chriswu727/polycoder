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
} as const

contextBridge.exposeInMainWorld('polycoder', polycoderAPI)

export type PolycoderAPI = typeof polycoderAPI

declare global {
  interface Window {
    polycoder: PolycoderAPI
  }
}
