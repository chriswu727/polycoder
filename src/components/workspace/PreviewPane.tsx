// Right-pane top half: live preview of the workspace's index.html.
//
// Fetches the preview URL from the main process (which boots a
// tiny single-tenant HTTP server keyed on the active workspace's
// workspace_root), then renders an iframe pointing at that URL.
// Reload on iteration change is driven by the `reloadKey` prop
// (typically the iteration_id) which forces the iframe to remount.

import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'

import { IconExternal, IconRefresh } from '@/components/icons.js'
import { useWorkspaceStore } from '@/stores/workspace.js'

const HEADER_BG: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  background: 'var(--bg-2)',
  borderBottom: '1px solid var(--hairline)',
}

export const EmptyPreview: FC<{ message: string; sub: string }> = ({ message, sub }) => (
  <div className="empty-preview">
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: 12,
        border: '1.5px dashed var(--border-strong)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface)',
        marginBottom: 4,
      }}
    >
      <svg width="32" height="32" viewBox="0 0 24 24">
        <rect
          x="4"
          y="4"
          width="16"
          height="16"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          opacity={0.4}
        />
        <path d="M4 9 L20 9 M9 4 L9 9" stroke="currentColor" strokeWidth={1.5} opacity={0.4} />
      </svg>
    </div>
    <div className="pc-mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
      {message}
    </div>
    <div style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 280 }}>{sub}</div>
  </div>
)

export type PreviewState =
  | { kind: 'empty-no-key' }
  | { kind: 'empty-idle' }
  | { kind: 'building' }
  | { kind: 'ready'; iterLabel: string; reloadKey?: string }
  | { kind: 'failed-show-prior' }

const LiveIframe: FC<{ url: string; reloadKey?: string | undefined }> = ({
  url,
  reloadKey,
}) => {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const lastReloadKey = useRef<string | undefined>(undefined)

  // Smooth reload: when reloadKey changes, ask the SAME iframe to
  // navigate fresh instead of remounting the element (which causes
  // a white-flash). On the very first mount we let the src attribute
  // do its job; subsequent reloads go through contentWindow.
  useEffect(() => {
    if (reloadKey === lastReloadKey.current) return
    const first = lastReloadKey.current === undefined
    lastReloadKey.current = reloadKey
    if (first) return
    const win = ref.current?.contentWindow
    if (win) {
      try {
        win.location.replace(url)
      } catch {
        // Cross-origin guard could throw; fall back to changing src.
        if (ref.current) ref.current.src = url
      }
    } else if (ref.current) {
      ref.current.src = url
    }
  }, [reloadKey, url])

  return (
    <iframe
      ref={ref}
      src={url}
      title="实时预览"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        background: 'white',
      }}
      sandbox="allow-scripts allow-forms allow-same-origin"
    />
  )
}

export const PreviewPane: FC<{ state: PreviewState }> = ({ state }) => {
  const current = useWorkspaceStore((s) => s.current)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Resolve the preview URL whenever the active workspace changes.
  // The main process boots the server lazily and points it at the
  // workspace_root; this gives us back a localhost URL we can iframe.
  useEffect(() => {
    if (!current) {
      setPreviewUrl(null)
      return
    }
    let cancelled = false
    const api = (window as unknown as {
      polycoder?: {
        workspace?: {
          previewUrl?: (req: { workspace_id: string }) => Promise<string | null>
        }
      }
    }).polycoder?.workspace?.previewUrl
    if (!api) {
      setPreviewUrl(null)
      return
    }
    void api({ workspace_id: current.id })
      .then((url) => {
        if (cancelled) return
        setPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [current])

  let content: React.ReactNode
  let header: React.ReactNode = null

  if (state.kind === 'empty-no-key') {
    content = (
      <EmptyPreview
        message="还没有项目"
        sub="起个名、加好 key，做出来的东西就出现在这里。"
      />
    )
  } else if (state.kind === 'empty-idle') {
    // Idle but workspace exists — preview iframe could still show
    // a previous index.html if one exists. We show that if the
    // server returned a URL; else the empty placeholder.
    if (previewUrl) {
      content = <LiveIframe url={previewUrl} reloadKey={`idle-${reloadTick}`} />
      header = (
        <div style={HEADER_BG}>
          <span className="pc-mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
            {current?.name} · index.html
          </span>
          <span className="status-pill" data-tone="muted" style={{ fontSize: 10 }}>
            实时
          </span>
          <span style={{ flex: 1 }} />
          <button
            className="pc-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => setReloadTick((t) => t + 1)}
            title="刷新预览"
          >
            <IconRefresh size={11} />
          </button>
          <button
            className="pc-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => {
              if (previewUrl) void window.open(previewUrl, '_blank')
            }}
            title="在浏览器中打开"
          >
            <IconExternal size={11} />
          </button>
        </div>
      )
    } else {
      content = (
        <EmptyPreview
          message="你的应用会出现在这里"
          sub="跟 PM 说一句要做什么，团队就开始干。"
        />
      )
    }
  } else if (state.kind === 'building') {
    content = (
      <EmptyPreview
        message="团队正在构建…"
        sub="做完会自动出现在这里，可以一边看右上角的进度。"
      />
    )
  } else if (state.kind === 'failed-show-prior') {
    if (previewUrl) {
      content = (
        <LiveIframe
          url={previewUrl}
          reloadKey={`failed-${reloadTick}`}
        />
      )
    } else {
      content = (
        <EmptyPreview
          message="上一个能跑的版本"
          sub="上一轮的成果原样保留——这一轮没动到它。"
        />
      )
    }
    header = (
      <div style={HEADER_BG}>
        <span className="status-pill" data-tone="muted">
          上一轮能跑的
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="pc-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={() => setReloadTick((t) => t + 1)}
          title="刷新预览"
        >
          <IconRefresh size={11} />
        </button>
      </div>
    )
  } else {
    // ready (iteration completed)
    if (previewUrl) {
      content = (
        <LiveIframe
          url={previewUrl}
          reloadKey={state.reloadKey ?? `tick-${reloadTick}`}
        />
      )
    } else {
      content = (
        <EmptyPreview
          message="预览服务还没启动"
          sub="重启 polycoder 启动预览服务。"
        />
      )
    }
    header = (
      <div style={HEADER_BG}>
        <span className="pc-mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
          {state.iterLabel}
        </span>
        <span className="status-pill" data-tone="muted" style={{ fontSize: 10 }}>
          实时预览
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="pc-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={() => setReloadTick((t) => t + 1)}
          title="刷新预览"
        >
          <IconRefresh size={11} />
        </button>
        <button
          className="pc-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={() => {
            if (previewUrl) void window.open(previewUrl, '_blank')
          }}
          title="在浏览器中打开"
        >
          <IconExternal size={11} />
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--surface)',
      }}
    >
      {header}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {content}
      </div>
    </div>
  )
}
