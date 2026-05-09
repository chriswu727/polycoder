// Electron main process entry point.
// Creates the app window, wires up IPC handlers, opens the
// app-private SQLite database, and instantiates the OS keystore.

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { openDatabase } from '../data/connection.js'
import { OsKeystore } from './secrets/keystore.js'
import { IPC_CHANNELS } from './ipc/channels.js'
import {
  handleAddSecret,
  handleListSecrets,
  handleRemoveSecret,
  handleTestSecret,
  type AddSecretRequest,
  type ListSecretsRequest,
  type RemoveSecretRequest,
  type TestSecretRequest,
} from './ipc/secretsHandlers.js'
import {
  handleCreateWorkspace,
  handleListWorkspaces,
  handleGetWorkspace,
  handleDeleteWorkspace,
  handleSetRoleAssignment,
  handleApplyPreset,
  type CreateWorkspaceRequest,
  type GetWorkspaceRequest,
  type DeleteWorkspaceRequest,
  type SetRoleAssignmentRequest,
  type ApplyPresetRequest,
} from './ipc/workspaceHandlers.js'
import {
  handleStartIteration,
  handleAbortIteration,
  handleListIterations,
  handleGetIteration,
  makeWebContentsForwarder,
  type StartIterationRequest,
  type AbortIterationRequest,
  type ListIterationsRequest,
  type GetIterationRequest,
} from './ipc/pipelineHandlers.js'
import type Database from 'better-sqlite3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const isDev = !app.isPackaged
const RENDERER_DEV_URL = 'http://localhost:5173'

let mainWindow: BrowserWindow | null = null
let db: Database.Database | null = null
const keystore = new OsKeystore()

function getDatabasePath(): string {
  const userData = app.getPath('userData')
  mkdirSync(userData, { recursive: true })
  return join(userData, 'polycoder.db')
}

function setupIpcHandlers(database: Database.Database): void {
  const deps = { db: database, keystore }

  ipcMain.handle(
    IPC_CHANNELS.SECRET_ADD,
    (_e, req: AddSecretRequest) => handleAddSecret(deps, req),
  )
  ipcMain.handle(
    IPC_CHANNELS.SECRET_LIST,
    (_e, req: ListSecretsRequest) => handleListSecrets(deps, req),
  )
  ipcMain.handle(
    IPC_CHANNELS.SECRET_REMOVE,
    (_e, req: RemoveSecretRequest) => handleRemoveSecret(deps, req),
  )
  ipcMain.handle(
    IPC_CHANNELS.SECRET_TEST,
    (_e, req: TestSecretRequest) => handleTestSecret(deps, req),
  )

  // Workspace
  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_CREATE,
    (_e, req: CreateWorkspaceRequest) => handleCreateWorkspace(database, req),
  )
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST, () =>
    handleListWorkspaces(database),
  )
  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_GET,
    (_e, req: GetWorkspaceRequest) => handleGetWorkspace(database, req),
  )
  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_DELETE,
    (_e, req: DeleteWorkspaceRequest) => handleDeleteWorkspace(database, req),
  )
  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_PICK_FOLDER,
    async (e, req: { defaultPath?: string } | undefined) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const result = await dialog.showOpenDialog(win ?? mainWindow!, {
        title: 'Pick a workspace folder',
        properties: ['openDirectory', 'createDirectory'],
        ...(req?.defaultPath ? { defaultPath: req.defaultPath } : {}),
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
  )

  // Roles
  ipcMain.handle(
    IPC_CHANNELS.ROLE_SET_ASSIGNMENT,
    (_e, req: SetRoleAssignmentRequest) => handleSetRoleAssignment(database, req),
  )
  ipcMain.handle(
    IPC_CHANNELS.ROLE_APPLY_PRESET,
    (_e, req: ApplyPresetRequest) => handleApplyPreset(database, req),
  )

  // Pipeline / iterations.
  // forwardEvent uses the IpcMainInvokeEvent's sender (the renderer
  // that initiated the start) so events are routed back to the same
  // window. Events emitted from non-IPC paths (the abort handler etc.)
  // fall back to broadcast — see makeWebContentsForwarder usage.
  ipcMain.handle(
    IPC_CHANNELS.ITERATION_START,
    (e, req: StartIterationRequest) =>
      handleStartIteration(
        {
          ...deps,
          forwardEvent: makeWebContentsForwarder(
            IPC_CHANNELS.ITERATION_EVENT,
            e.sender,
          ),
        },
        req,
      ),
  )
  ipcMain.handle(
    IPC_CHANNELS.ITERATION_ABORT,
    (e, req: AbortIterationRequest) =>
      handleAbortIteration(
        {
          ...deps,
          forwardEvent: makeWebContentsForwarder(
            IPC_CHANNELS.ITERATION_EVENT,
            e.sender,
          ),
        },
        req,
      ),
  )
  ipcMain.handle(
    IPC_CHANNELS.ITERATION_LIST,
    (e, req: ListIterationsRequest) =>
      handleListIterations(
        {
          ...deps,
          forwardEvent: makeWebContentsForwarder(
            IPC_CHANNELS.ITERATION_EVENT,
            e.sender,
          ),
        },
        req,
      ),
  )
  ipcMain.handle(
    IPC_CHANNELS.ITERATION_GET,
    (e, req: GetIterationRequest) =>
      handleGetIteration(
        {
          ...deps,
          forwardEvent: makeWebContentsForwarder(
            IPC_CHANNELS.ITERATION_EVENT,
            e.sender,
          ),
        },
        req,
      ),
  )
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'polycoder',
    webPreferences: {
      // CJS preload bundled via esbuild — Electron's contextBridge
      // injection on ESM preload was silently dropping the exposed
      // object in Electron 34. See V0.1.1 hot-fixes commit for the
      // diagnosis.
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false because preload.js is ESM (compiled with
      // module: ESNext for the rest of the electron tsconfig).
      // Electron's sandboxed preload requires CommonJS — making
      // the preload CJS while keeping main ESM needs a separate
      // tsconfig pass; deferred. Tracked as a V0.1.1 follow-up.
      sandbox: false,
    },
  })

  // V0.1.1 diagnostic: ask the renderer what window.polycoder
  // looks like after page load, write to disk so we can read it.
  win.webContents.on('did-finish-load', () => {
    void (async () => {
      try {
        const result = await win.webContents.executeJavaScript(`
          (() => {
            const api = window.polycoder;
            return {
              hasPolycoder: typeof api,
              topKeys: api ? Object.keys(api) : [],
              workspaceKeys: api?.workspace ? Object.keys(api.workspace) : null,
              hasPickFolder: typeof api?.workspace?.pickFolder,
              version: api?.version,
            };
          })()
        `)
        const { writeFileSync } = await import('node:fs')
        writeFileSync(
          '/tmp/polycoder-renderer-diag.json',
          JSON.stringify({ ts: new Date().toISOString(), ...result }, null, 2),
        )
      } catch (e) {
        const { writeFileSync } = await import('node:fs')
        writeFileSync(
          '/tmp/polycoder-renderer-diag.json',
          JSON.stringify({ ts: new Date().toISOString(), error: String(e) }, null, 2),
        )
      }
    })()
  })
  if (isDev) {
    void win.loadURL(RENDERER_DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  return win
}

void app.whenReady().then(() => {
  db = openDatabase(getDatabasePath())
  setupIpcHandlers(db)

  mainWindow = createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (db) {
    db.close()
    db = null
  }
})
