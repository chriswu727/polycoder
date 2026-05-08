// Electron preload script.
// Runs in the renderer's isolated world before page scripts. Exposes a
// minimal, typed API surface to the renderer via contextBridge.
//
// V0.1: skeleton. Layer D (Secret manager) and Layer G (orchestrator)
// will populate this with real IPC bridges.

import { contextBridge } from 'electron'

const polycoderAPI = {
  version: '0.0.1',
  // IPC handlers added incrementally — see electron/ipc/* (forthcoming).
} as const

contextBridge.exposeInMainWorld('polycoder', polycoderAPI)

export type PolycoderAPI = typeof polycoderAPI

declare global {
  interface Window {
    polycoder: PolycoderAPI
  }
}
