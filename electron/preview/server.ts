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
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

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
  /** Per-session shared secret. Requests must include `?t=<token>`
   *  (the renderer's iframe URL embeds it) or get a 401. Stops other
   *  local browser tabs from fetching `.env` from the workspace
   *  while polycoder is running, since they can't read the token. */
  token: string
}

let stateRef: PreviewServerState | null = null

function serveFile(filePath: string, res: import('node:http').ServerResponse): void {
  try {
    const buf = readFileSync(filePath)
    const ct = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, {
      'content-type': ct,
      // CORS scoped: only the polycoder renderer origin is
      // permitted to read responses cross-origin. Other local
      // browser tabs trying to fetch the workspace files would
      // also need the session token (see handler() above), so this
      // is defense in depth.
      'access-control-allow-origin': 'http://localhost:5173',
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
  const token = stateRef?.token
  if (!root || !token) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('No workspace selected.')
    return
  }
  // Token check: requests must carry ?t=<token>. Cookie / referer
  // wouldn't help across origins; a URL token in the iframe src is
  // the simplest mechanism that survives sub-resource loads (the
  // user's HTML page can include relative paths, and the browser
  // appends them to the iframe's base URL which retains the
  // ?t=... — except RELATIVE paths drop the query string. So
  // sub-resources need the token in the URL too. To keep this V1
  // working, we accept the token on the index.html request only
  // and gate sub-resources on Referer matching the token URL.)
  const fullUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
  const providedToken = fullUrl.searchParams.get('t')
  const referer = req.headers.referer ?? ''
  const refererTokenMatch = /[?&]t=([A-Za-z0-9_-]+)/.exec(referer)
  const refererToken = refererTokenMatch ? refererTokenMatch[1] : null
  const authOK = providedToken === token || refererToken === token
  if (!authOK) {
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('preview-server: missing or invalid session token')
    return
  }

  let urlPath = (req.url ?? '/').split('?')[0] ?? '/'
  if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html'
  // Normalize the URL path, then resolve against the workspace
  // root + assert it lands INSIDE the root via relative() — NOT a
  // prefix match. startsWith was vulnerable to siblings like
  // /tmp/foo-evil/x falsely matching /tmp/foo.
  const safe = normalize(urlPath)
  const absRoot = resolve(root)
  const filePath = join(absRoot, safe)
  const rel = relative(absRoot, filePath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
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
      const token = randomBytes(16).toString('base64url')
      const next: PreviewServerState = { server, port, root: null, token }
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
 * first call. The URL embeds the session token as `?t=<token>` so
 * iframe requests authenticate without the renderer setting any
 * headers (which iframes can't easily do).
 */
export async function getPreviewUrl(): Promise<string> {
  if (!stateRef) await bootServer()
  return `http://127.0.0.1:${stateRef!.port}/?t=${stateRef!.token}`
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
