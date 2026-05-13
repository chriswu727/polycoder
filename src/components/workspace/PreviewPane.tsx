// Right-pane top half: live preview of the workspace's index.html.
//
// Fetches the preview URL from the main process (which boots a
// tiny single-tenant HTTP server keyed on the active workspace's
// workspace_root), then renders an iframe pointing at that URL.
// Reload on iteration change is driven by the `reloadKey` prop
// (typically the iteration_id) which forces the iframe to remount.

import { useEffect, useState } from 'react'
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

const LiveIframe: FC<{ url: string; reloadKey?: string | undefined }> = ({ url, reloadKey }) => (
  <iframe
    key={reloadKey ?? url}
    src={url}
    title="Live preview"
    style={{
      width: '100%',
      height: '100%',
      border: 'none',
      background: 'white',
    }}
    sandbox="allow-scripts allow-forms allow-same-origin"
  />
)

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
        message="No project yet"
        sub="Once you've named a project and added a key, your app will live here."
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
            live
          </span>
          <span style={{ flex: 1 }} />
          <button
            className="pc-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => setReloadTick((t) => t + 1)}
            title="Reload preview"
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
            title="Open in browser"
          >
            <IconExternal size={11} />
          </button>
        </div>
      )
    } else {
      content = (
        <EmptyPreview
          message="Your app will appear here"
          sub="Send a prompt and your team will start building."
        />
      )
    }
  } else if (state.kind === 'building') {
    content = (
      <EmptyPreview
        message="Building…"
        sub="Your app preview will pop in here when the team finishes."
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
          message="Last working version"
          sub="The previous iteration is preserved exactly as you left it."
        />
      )
    }
    header = (
      <div style={HEADER_BG}>
        <span className="status-pill" data-tone="muted">
          last working
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="pc-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={() => setReloadTick((t) => t + 1)}
          title="Reload preview"
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
          message="No preview server yet"
          sub="Restart polycoder to start the preview server."
        />
      )
    }
    header = (
      <div style={HEADER_BG}>
        <span className="pc-mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
          {state.iterLabel}
        </span>
        <span className="status-pill" data-tone="muted" style={{ fontSize: 10 }}>
          live preview
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="pc-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={() => setReloadTick((t) => t + 1)}
          title="Reload preview"
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
          title="Open in browser"
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
