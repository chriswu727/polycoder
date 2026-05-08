// Electron preload script.
// Runs in the renderer's isolated world before page scripts. Exposes a
// minimal, typed API surface to the renderer via contextBridge.
//
// Renderer NEVER sees plaintext API keys. addSecret accepts the key
// (as a transient input from a UI form) but the response only echoes
// metadata; subsequent reads return metadata only.

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

const polycoderAPI = {
  version: '0.0.1',

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
