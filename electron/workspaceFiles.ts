// Workspace file walking + reading for the in-app code viewer.
//
// Two surfaces:
//   * listWorkspaceFiles(root)  — returns a flat list of file paths
//                                  relative to root, with size + a
//                                  hint for syntax highlighting.
//   * readWorkspaceFile(root, displayPath) — returns the file
//                                  content, capped + workspace-bounded.
//
// Conservative defaults so a workspace pointed at a node_modules-
// heavy folder doesn't melt the renderer:
//   * skip dot-prefixed entries and `node_modules`
//   * limit depth to 5 levels
//   * cap total returned entries at 500
//   * per-file read limit 200 KB (sufficient for vibe-coder code,
//     keeps the IPC payload bounded).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, relative, isAbsolute, normalize, extname, join } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '.vite',
  '.parcel-cache',
  '.idea',
  '.vscode',
])
const MAX_DEPTH = 5
const MAX_ENTRIES = 500
const MAX_FILE_BYTES = 200 * 1024

/**
 * Filenames matching these patterns are NEVER served via
 * listWorkspaceFiles or readWorkspaceFile. Defense in depth against
 * a prompt-injected Coder writing secrets into a workspace file and
 * the renderer (or a compromised iframe) reading them back.
 *
 * The Code tab + Producer's read_workspace_file tool both go
 * through these checks.
 */
const DENY_PATTERNS: RegExp[] = [
  /^\.env(\.|$)/i, // .env, .env.local, .env.production, etc.
  /\.env(\..*)?$/i, // any .env variant
  /\.(pem|key|p12|pfx|cer|crt)$/i, // crypto material
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i, // SSH keys
  /(^|\/)\.npmrc$/i, // can contain auth tokens
  /(^|\/)\.netrc$/i, // can contain HTTP creds
  /(^|\/)\.aws\//i, // AWS profile dir
  /(^|\/)credentials(\.json|\.txt)?$/i, // generic creds
  /\.cookies?$/i,
]

function isSensitivePath(displayPath: string): boolean {
  return DENY_PATTERNS.some((re) => re.test(displayPath))
}

export type WorkspaceFileEntry = {
  path: string // relative, forward-slash separated
  size: number
  language: string // hint for syntax highlighting (codemirror lang)
}

export function listWorkspaceFiles(root: string): WorkspaceFileEntry[] {
  const absRoot = resolve(root)
  const out: WorkspaceFileEntry[] = []
  function walk(dir: string, depth: number): void {
    if (out.length >= MAX_ENTRIES || depth > MAX_DEPTH) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (out.length >= MAX_ENTRIES) return
      if (name.startsWith('.')) continue
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!stat.isFile()) continue
      const rel = relative(absRoot, full).split('\\').join('/')
      if (isSensitivePath(rel)) continue
      out.push({
        path: rel,
        size: stat.size,
        language: detectLanguage(name),
      })
    }
  }
  walk(absRoot, 0)
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

export type ReadWorkspaceFileResult =
  | { ok: true; path: string; size: number; content: string; language: string; truncated: boolean }
  | { ok: false; error: string }

export function readWorkspaceFile(
  root: string,
  displayPath: string,
): ReadWorkspaceFileResult {
  const absRoot = normalize(resolve(root))
  const abs = isAbsolute(displayPath)
    ? normalize(displayPath)
    : normalize(resolve(absRoot, displayPath))
  const rel = relative(absRoot, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: 'path resolves outside workspace' }
  }
  const relForward = rel.split('\\').join('/')
  if (isSensitivePath(relForward)) {
    return { ok: false, error: 'file is on the deny list (secret-like name)' }
  }
  let stat
  try {
    stat = statSync(abs)
  } catch {
    return { ok: false, error: 'file not found' }
  }
  if (!stat.isFile()) return { ok: false, error: 'not a regular file' }
  const cap = Math.min(stat.size, MAX_FILE_BYTES)
  let raw: string
  try {
    raw = readFileSync(abs, 'utf8')
  } catch (e) {
    return {
      ok: false,
      error: `read failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
  const truncated = stat.size > cap
  const content = truncated ? raw.slice(0, cap) + '\n…(truncated)' : raw
  return {
    ok: true,
    path: rel.split('\\').join('/'),
    size: stat.size,
    content,
    language: detectLanguage(displayPath),
    truncated,
  }
}

function detectLanguage(name: string): string {
  const ext = extname(name).toLowerCase()
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript'
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript'
    case '.html':
    case '.htm':
      return 'html'
    case '.css':
    case '.scss':
    case '.less':
      return 'css'
    case '.json':
      return 'json'
    case '.md':
    case '.markdown':
      return 'markdown'
    case '.py':
      return 'python'
    case '.go':
      return 'go'
    case '.rs':
      return 'rust'
    case '.yml':
    case '.yaml':
      return 'yaml'
    default:
      return 'plain'
  }
}
