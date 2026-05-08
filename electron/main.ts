// Electron main process entry point.
// Responsibilities (V0.1): create the app window, load the renderer
// (Vite dev server in dev, file:// in prod), basic lifecycle.
//
// Layers D (Secret manager) and beyond will add IPC handlers here.

import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const isDev = !app.isPackaged
const RENDERER_DEV_URL = 'http://localhost:5173'

let mainWindow: BrowserWindow | null = null

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
