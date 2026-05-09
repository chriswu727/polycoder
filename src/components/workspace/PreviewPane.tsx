// Right-pane top half: live preview of the workspace's index.html.
//
// V0.2 status: placeholder UI only. The real preview (a tiny
// in-process http-server serving workspace_root + an <iframe>) is
// the V0.1.2 follow-up — needs a new IPC channel and a server
// lifecycle tied to workspace switching.
//
// In the meantime we render an "EmptyPreview" with state-aware
// copy so the right-side layout doesn't collapse.

import type { FC } from 'react'
import { IconRefresh, IconExternal } from '@/components/icons.js'

const HEADER_BG: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  background: 'var(--bg-2)',
  borderBottom: '1px solid var(--hairline)',
}

export const EmptyPreview: FC<{ message: string; sub: string }> = ({ message, sub }) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      padding: 32,
      textAlign: 'center',
      background:
        'repeating-linear-gradient(135deg, var(--surface-sunk), var(--surface-sunk) 10px, var(--bg-2) 10px, var(--bg-2) 11px)',
      color: 'var(--ink-3)',
    }}
  >
    <div
      style={{
        width: 72,
        height: 72,
        borderRadius: 12,
        border: '1.5px dashed var(--border-strong)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        marginBottom: 8,
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
    <div style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 280 }}>
      {sub}
    </div>
  </div>
)

export type PreviewState =
  | { kind: 'empty-no-key' }
  | { kind: 'empty-idle' }
  | { kind: 'building' }
  | { kind: 'ready'; iterLabel: string }
  | { kind: 'failed-show-prior' }

export const PreviewPane: FC<{ state: PreviewState }> = ({ state }) => {
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
    content = (
      <EmptyPreview
        message="Your app will appear here"
        sub="Send a prompt and your team will start building."
      />
    )
  } else if (state.kind === 'building') {
    content = (
      <EmptyPreview
        message="Building…"
        sub="Your app preview will pop in here when the team finishes."
      />
    )
  } else if (state.kind === 'failed-show-prior') {
    content = (
      <EmptyPreview
        message="Last working version"
        sub="The previous iteration is preserved exactly as you left it."
      />
    )
    header = (
      <div style={HEADER_BG}>
        <span className="status-pill" data-tone="muted">
          last working
        </span>
        <span style={{ flex: 1 }} />
        <button className="pc-btn" data-variant="ghost" data-size="sm" disabled title="Open in browser (V0.1.2)">
          <IconExternal size={11} />
        </button>
      </div>
    )
  } else {
    // ready — V0.2 stub. The real iframe needs a workspace HTTP
    // server (see V0.1.2 plan). Showing the empty pattern with the
    // "live preview" header so the layout reads right.
    content = (
      <EmptyPreview
        message="Live preview · V0.1.2"
        sub="Your workspace's index.html will render here once the in-process server is wired up."
      />
    )
    header = (
      <div style={HEADER_BG}>
        <span className="pc-mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
          {state.iterLabel}
        </span>
        <span className="status-pill" data-tone="muted" style={{ fontSize: 10 }}>
          live preview
        </span>
        <span style={{ flex: 1 }} />
        <button className="pc-btn" data-variant="ghost" data-size="sm" disabled title="Reload preview (V0.1.2)">
          <IconRefresh size={11} />
        </button>
        <button className="pc-btn" data-variant="ghost" data-size="sm" disabled title="Open in browser (V0.1.2)">
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
