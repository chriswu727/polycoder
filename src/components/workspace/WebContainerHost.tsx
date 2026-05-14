// WebContainer host — experimental in-browser sandbox for framework
// projects. Mounts workspace files into a WebContainer instance and
// runs `pnpm install && pnpm dev` so the user can preview a Vite/
// React/etc. project WITHOUT installing node locally.
//
// REQUIREMENTS (scaffold caveat — not yet wired):
//   1. Renderer page must be served with Cross-Origin-Opener-Policy:
//      same-origin AND Cross-Origin-Embedder-Policy: require-corp.
//      Vite dev server needs these headers; Electron's BrowserWindow
//      also needs to allow them.
//   2. Workspace files have to be transferred to the WebContainer
//      filesystem via the API. Currently uses a fresh IPC call to
//      list+read files — for large workspaces this is slow.
//   3. WebContainer's outbound URL is iframed back into preview.
//
// V1 status: scaffold. Boot is attempted; on the (very likely)
// COOP/COEP failure, an informative message + fallback to the
// existing static HTTP preview server. Full integration is a
// next-session deliverable.

import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import type { WebContainer } from '@webcontainer/api'

import { useWorkspaceStore } from '@/stores/workspace.js'

type BootState =
  | { kind: 'idle' }
  | { kind: 'booting'; message: string }
  | { kind: 'running'; url: string }
  | { kind: 'failed'; reason: string }

export const WebContainerHost: FC = () => {
  const current = useWorkspaceStore((s) => s.current)
  const [state, setState] = useState<BootState>({ kind: 'idle' })
  const containerRef = useRef<WebContainer | null>(null)

  useEffect(() => {
    if (!current) return
    let cancelled = false

    void (async () => {
      // Sanity check: cross-origin isolation must be on for
      // WebContainer to boot. If missing, surface a useful error
      // rather than getting cryptic SharedArrayBuffer errors later.
      if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
        if (!cancelled) {
          setState({
            kind: 'failed',
            reason:
              '当前 polycoder app 还没开启跨源隔离 (COOP/COEP)，WebContainer 没法启动。请用 Preview 标签查看 (或等下一版接通环境头)。',
          })
        }
        return
      }

      setState({ kind: 'booting', message: '正在启动浏览器内沙盒...' })

      try {
        const mod = await import('@webcontainer/api')
        const inst = await mod.WebContainer.boot()
        containerRef.current = inst
        if (cancelled) {
          await inst.teardown()
          return
        }

        // Mount workspace files.
        setState({ kind: 'booting', message: '把项目文件搬进沙盒...' })
        const files = await window.polycoder.workspace.listFiles({
          workspace_id: current.id,
        })
        const tree: Record<string, { file: { contents: string } }> = {}
        for (const f of files) {
          const r = await window.polycoder.workspace.readFile({
            workspace_id: current.id,
            path: f.path,
          })
          if (r.ok) {
            tree[f.path] = { file: { contents: r.content } }
          }
        }
        if (cancelled) {
          await inst.teardown()
          return
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await inst.mount(tree as any)

        // Detect framework. If package.json exists, run install + dev.
        const hasPackageJson = files.some((f) => f.path === 'package.json')
        if (!hasPackageJson) {
          setState({
            kind: 'failed',
            reason:
              '当前项目是静态 HTML（没有 package.json），不需要沙盒——用 Preview 标签即可。',
          })
          return
        }

        setState({ kind: 'booting', message: '安装依赖 (pnpm install)...' })
        const install = await inst.spawn('npm', ['install'])
        const installCode = await install.exit
        if (cancelled) return
        if (installCode !== 0) {
          setState({
            kind: 'failed',
            reason: `npm install 失败 (exit ${installCode})`,
          })
          return
        }

        setState({ kind: 'booting', message: '启动 dev server...' })
        await inst.spawn('npm', ['run', 'dev'])

        // Listen for the server-ready event
        inst.on('server-ready', (_port, url) => {
          if (!cancelled) setState({ kind: 'running', url })
        })
      } catch (e) {
        if (!cancelled) {
          setState({
            kind: 'failed',
            reason: e instanceof Error ? e.message : String(e),
          })
        }
      }
    })()

    return () => {
      cancelled = true
      if (containerRef.current) {
        void containerRef.current.teardown()
        containerRef.current = null
      }
    }
  }, [current?.id, current])

  if (!current) return null

  if (state.kind === 'running') {
    return (
      <iframe
        title="WebContainer preview"
        src={state.url}
        sandbox="allow-scripts allow-forms allow-same-origin"
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    )
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 320 }}>
        <div className="pc-eyebrow" style={{ marginBottom: 8 }}>
          WebContainer (实验)
        </div>
        {state.kind === 'idle' || state.kind === 'booting' ? (
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {state.kind === 'booting'
              ? state.message
              : '准备启动浏览器内沙盒...'}
          </div>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              lineHeight: 1.5,
            }}
          >
            {state.reason}
          </div>
        )}
      </div>
    </div>
  )
}
