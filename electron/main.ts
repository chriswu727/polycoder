// Electron main process entry point.
// Creates the app window, wires up IPC handlers, opens the
// app-private SQLite database, and instantiates the OS keystore.

import { app, BrowserWindow, ipcMain } from 'electron'
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

  // Roles
  ipcMain.handle(
    IPC_CHANNELS.ROLE_SET_ASSIGNMENT,
    (_e, req: SetRoleAssignmentRequest) => handleSetRoleAssignment(database, req),
  )
  ipcMain.handle(
    IPC_CHANNELS.ROLE_APPLY_PRESET,
    (_e, req: ApplyPresetRequest) => handleApplyPreset(database, req),
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
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
