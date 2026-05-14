// Module-level WebContainer singleton. Holds at most one running
// WebContainer instance per renderer process, keyed by workspace_id.
//
// Why singleton: previously, WebContainerHost mounted = boot, unmounted =
// teardown. The user clicking the 沙盒 tab triggered a 5-10s boot every
// time, and switching tabs threw the WebContainer away. This made the
// tab feel like a crash to demo audiences.
//
// New behavior: WorkspaceShell calls ensureForWorkspace(id) the moment
// a workspace opens, so by the time the user clicks 沙盒, the container
// is already booting / ready. WebContainerHost subscribes to the
// singleton's state and renders accordingly — it never owns boot/teardown.
//
// Teardown happens only on:
//   - workspace switch (different workspace_id)
//   - explicit shutdown() call (not currently surfaced in UI)

import type { WebContainer } from '@webcontainer/api'

const PKG_MANAGERS = ['pnpm', 'yarn', 'bun', 'npm'] as const
type PkgManager = (typeof PKG_MANAGERS)[number]

function detectPackageManager(files: string[]): PkgManager {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm'
  if (files.includes('yarn.lock')) return 'yarn'
  if (files.includes('bun.lock') || files.includes('bun.lockb')) return 'bun'
  return 'npm'
}

export type WebContainerState =
  | { kind: 'idle' }
  | { kind: 'booting'; message: string; progress01: number }
  | { kind: 'running'; url: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'static-html' }

type Subscriber = (s: WebContainerState) => void

const subscribers = new Set<Subscriber>()
let state: WebContainerState = { kind: 'idle' }
let activeWorkspaceId: string | null = null
let instance: WebContainer | null = null
let bootInFlight: Promise<void> | null = null

function setState(next: WebContainerState): void {
  state = next
  for (const cb of subscribers) {
    try {
      cb(next)
    } catch {
      // sub errors must not break the manager
    }
  }
}

export function getWebContainerState(): WebContainerState {
  return state
}

export function subscribeWebContainer(cb: Subscriber): () => void {
  subscribers.add(cb)
  cb(state)
  return () => {
    subscribers.delete(cb)
  }
}

/**
 * Boot (or reuse) a WebContainer for the given workspace. Safe to
 * call repeatedly — if a boot is already in flight or the container
 * is already running for this workspace, this is a no-op.
 *
 * If called with a different workspace_id, the prior container is
 * torn down first.
 */
export async function ensureWebContainerForWorkspace(
  workspaceId: string,
): Promise<void> {
  if (activeWorkspaceId === workspaceId && state.kind !== 'idle') {
    // Already booting / running / failed for this workspace.
    return bootInFlight ?? Promise.resolve()
  }
  if (activeWorkspaceId !== workspaceId) {
    await shutdown()
  }
  activeWorkspaceId = workspaceId
  bootInFlight = bootCore(workspaceId)
  try {
    await bootInFlight
  } finally {
    bootInFlight = null
  }
}

async function bootCore(workspaceId: string): Promise<void> {
  if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
    setState({
      kind: 'failed',
      reason:
        '当前 polycoder 还没开启跨源隔离 (COOP/COEP)，浏览器沙盒没法启动——用「预览」标签查看输出。',
    })
    return
  }

  setState({ kind: 'booting', message: '启动浏览器内沙盒…', progress01: 0.1 })

  try {
    const mod = await import('@webcontainer/api')
    if (activeWorkspaceId !== workspaceId) return
    const inst = await mod.WebContainer.boot()
    instance = inst
    if (activeWorkspaceId !== workspaceId) {
      void inst.teardown()
      instance = null
      return
    }

    setState({ kind: 'booting', message: '搬入项目文件…', progress01: 0.35 })
    const files = await window.polycoder.workspace.listFiles({
      workspace_id: workspaceId,
    })
    if (activeWorkspaceId !== workspaceId) return

    const tree: Record<string, { file: { contents: string } }> = {}
    for (const f of files) {
      if (activeWorkspaceId !== workspaceId) return
      const r = await window.polycoder.workspace.readFile({
        workspace_id: workspaceId,
        path: f.path,
      })
      if (r.ok) {
        tree[f.path] = { file: { contents: r.content } }
      }
    }
    if (activeWorkspaceId !== workspaceId) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await inst.mount(tree as any)

    const pkgEntry = tree['package.json']
    if (!pkgEntry) {
      // Static-HTML projects don't need a sandbox — surface a friendly
      // distinct state so the host can route to a clear message rather
      // than calling that "failed."
      setState({ kind: 'static-html' })
      return
    }
    const pm = detectPackageManager(files.map((f) => f.path))

    setState({
      kind: 'booting',
      message: `安装依赖（${pm} install）…`,
      progress01: 0.55,
    })
    const install = await inst.spawn(pm, ['install'])
    const installCode = await install.exit
    if (activeWorkspaceId !== workspaceId) return
    if (installCode !== 0) {
      setState({
        kind: 'failed',
        reason: `${pm} install 失败（exit ${installCode}）`,
      })
      return
    }

    setState({ kind: 'booting', message: '启动 dev server…', progress01: 0.85 })
    void inst.spawn(pm, ['run', 'dev'])
    inst.on('server-ready', (_port, url) => {
      if (activeWorkspaceId === workspaceId) {
        setState({ kind: 'running', url })
      }
    })
  } catch (e) {
    setState({
      kind: 'failed',
      reason: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * Tear down the active container and reset state. Called on workspace
 * switch and app shutdown.
 */
export async function shutdown(): Promise<void> {
  const inst = instance
  instance = null
  activeWorkspaceId = null
  setState({ kind: 'idle' })
  if (inst) {
    try {
      await inst.teardown()
    } catch {
      // teardown errors aren't actionable
    }
  }
}
