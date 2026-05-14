// Tiny single-tenant HTTP server that serves the active workspace's
// workspace_root directory. Used by the renderer's PreviewPane to
// embed an iframe of the user's iterating-on app (typically
// index.html + assets).
//
// One instance per Electron process. Lazily booted on the first
// IPC call; setWorkspaceRoot rebinds the served directory without
// restarting the server (the iframe doesn't need to reconnect).
// SPA fallback: 404s on non-existent paths return index.html so
// React/Vue-style apps work without per-route config.
//
// Security: path traversal blocked. Only the configured directory
// is served. No directory listings.

import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const PORT_MIN = 5180
const PORT_MAX = 5189

type PreviewServerState = {
  server: Server
  port: number
  root: string | null
}

let stateRef: PreviewServerState | null = null

function serveFile(filePath: string, res: import('node:http').ServerResponse): void {
  try {
    const buf = readFileSync(filePath)
    const ct = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, {
      'content-type': ct,
      // CORS: allow embedding from any origin (renderer is file://
      // or http://localhost:5173). Restrictive enough — this server
      // only ever holds the user's own workspace files.
      'access-control-allow-origin': '*',
      // Renderer runs Cross-Origin-Embedder-Policy: require-corp so
      // the Sandbox/WebContainer tab can use SharedArrayBuffer.
      // Iframes of THIS preview server need an explicit CORP header
      // or COEP blocks the iframe.
      'cross-origin-resource-policy': 'cross-origin',
      // Don't let stale assets stick around between iterations.
      'cache-control': 'no-store',
    })
    res.end(buf)
  } catch {
    res.writeHead(500)
    res.end('read error')
  }
}

function handler(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): void {
  const root = stateRef?.root
  if (!root) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('No workspace selected.')
    return
  }
  let urlPath = (req.url ?? '/').split('?')[0] ?? '/'
  if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html'
  // Block path traversal — drop any '..' segments.
  const safe = normalize(urlPath).replace(/^([\\/]\.\.+)+/g, '/')
  const filePath = join(root, safe)
  // Make sure the resolved path is inside root (defense in depth).
  if (!filePath.startsWith(resolve(root))) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    serveFile(filePath, res)
    return
  }
  // SPA fallback — for non-existent paths, return index.html.
  const fallback = join(root, 'index.html')
  if (existsSync(fallback)) {
    serveFile(fallback, res)
    return
  }
  // Workspace has nothing useful yet.
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
  res.end(
    '<!doctype html><html><head><meta charset="utf-8"><title>no preview yet</title>' +
      '<style>body{font-family:-apple-system,system-ui,sans-serif;color:#888;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;}p{font-size:13px;}</style>' +
      '</head><body><p>This workspace has no index.html yet. Once your team writes one, it shows up here.</p></body></html>',
  )
}

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler)
    const onError = (e: Error): void => {
      server.removeListener('error', onError)
      reject(e)
    }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError)
      resolve(server)
    })
  })
}

async function bootServer(): Promise<PreviewServerState> {
  let lastErr: unknown = null
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    try {
      const server = await listen(port)
      const next: PreviewServerState = { server, port, root: null }
      stateRef = next
      return next
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(
    `preview-server: no free port in [${PORT_MIN}..${PORT_MAX}] — last error: ${String(lastErr)}`,
  )
}

/**
 * Returns the URL of the running preview server, booting it on
 * first call. Subsequent calls return the same URL — the server
 * is process-global. Setting the root after boot is via setRoot().
 */
export async function getPreviewUrl(): Promise<string> {
  if (!stateRef) await bootServer()
  return `http://127.0.0.1:${stateRef!.port}/`
}

/**
 * Point the running server at a new workspace_root. Called on
 * workspace switch + iteration completion. No restart — the
 * iframe just needs to reload.
 */
export function setPreviewRoot(root: string | null): void {
  if (stateRef) stateRef.root = root
}

/** Stop the server cleanly on app quit. */
export function stopPreviewServer(): Promise<void> {
  if (!stateRef) return Promise.resolve()
  const s = stateRef
  stateRef = null
  return new Promise((resolve) => {
    s.server.close(() => resolve())
  })
}
