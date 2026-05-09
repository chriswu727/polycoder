// Left pane — workspace switcher (top), "New prompt" button, then a
// scrolling list of past iterations for the current workspace, then
// a Settings entry at the bottom.

import { useEffect, useState } from 'react'
import type { FC } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import { Mark, IconChevronDown, IconPlus, IconSettings } from '@/components/icons.js'

type IterationRow = {
  id: string
  iteration_number: number
  user_prompt: string
  status: string
  traffic_light: 'green' | 'yellow' | 'red' | null
  duration_ms: number | null
  total_cost_usd: number | null
  started_at: number
}

const VerdictDot: FC<{ v: IterationRow['traffic_light'] | undefined; size?: number }> = ({
  v,
  size = 8,
}) => {
  const color =
    v === 'green'
      ? 'var(--green)'
      : v === 'yellow'
        ? 'var(--amber)'
        : v === 'red'
          ? 'var(--red)'
          : 'var(--ink-3)'
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        display: 'inline-block',
        flex: '0 0 auto',
      }}
    />
  )
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(ms: number | null): string {
  if (!ms) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

export const Sidebar: FC<{
  activeIter: string | null
  onSelectIter: (id: string) => void
  onNewPrompt: () => void
  onOpenSettings: () => void
  onCreateWorkspace: () => void
}> = ({ activeIter, onSelectIter, onNewPrompt, onOpenSettings, onCreateWorkspace }) => {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const current = useWorkspaceStore((s) => s.current)
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace)
  const [wsOpen, setWsOpen] = useState(false)
  const [iters, setIters] = useState<IterationRow[]>([])

  useEffect(() => {
    if (!current) {
      setIters([])
      return
    }
    let cancelled = false
    void window.polycoder.iteration
      .list({ workspace_id: current.id, limit: 30 })
      .then((rows) => {
        if (cancelled) return
        setIters(rows as IterationRow[])
      })
      .catch(() => {
        if (!cancelled) setIters([])
      })
    return () => {
      cancelled = true
    }
  }, [current])

  return (
    <div className="pane pane-history">
      {/* Workspace switcher */}
      <div
        style={{
          position: 'relative',
          padding: 10,
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <button
          onClick={() => setWsOpen(!wsOpen)}
          className="pc-btn"
          style={{
            width: '100%',
            justifyContent: 'flex-start',
            gap: 8,
            background: 'var(--surface)',
            padding: '7px 10px',
          }}
        >
          <Mark size={16} />
          <div
            style={{
              flex: 1,
              textAlign: 'left',
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {current ? current.name : 'No project selected'}
            </div>
            <div className="pc-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
              {current ? `${iters.length} iteration${iters.length === 1 ? '' : 's'}` : 'create one →'}
            </div>
          </div>
          <IconChevronDown size={12} />
        </button>
        {wsOpen ? (
          <div
            className="fade-up"
            style={{
              position: 'absolute',
              left: 10,
              right: 10,
              top: 50,
              zIndex: 20,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-2)',
              padding: 6,
            }}
          >
            {workspaces.map((w) => {
              const isActive = current?.id === w.id
              return (
                <button
                  key={w.id}
                  onClick={() => {
                    setWsOpen(false)
                    if (!isActive) void selectWorkspace(w.id)
                  }}
                  className="pc-btn"
                  data-variant="ghost"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    background: isActive ? 'var(--surface-2)' : 'transparent',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: isActive ? 'var(--accent)' : 'var(--border-strong)',
                    }}
                  />
                  <span style={{ flex: 1, textAlign: 'left' }}>{w.name}</span>
                </button>
              )
            })}
            <div style={{ height: 1, background: 'var(--hairline)', margin: '6px 0' }} />
            <button
              className="pc-btn"
              data-variant="ghost"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                setWsOpen(false)
                onCreateWorkspace()
              }}
            >
              <IconPlus size={12} /> New project
            </button>
          </div>
        ) : null}
      </div>

      {/* New prompt */}
      <div style={{ padding: 10 }}>
        <button
          onClick={onNewPrompt}
          className="pc-btn"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <IconPlus size={12} /> New prompt
        </button>
      </div>

      {/* History */}
      <div style={{ padding: '4px 14px 6px' }}>
        <div className="pc-eyebrow">Iterations</div>
      </div>
      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
        {iters.length === 0 ? (
          <div
            style={{
              padding: '20px 14px',
              color: 'var(--ink-3)',
              fontSize: 12,
              textAlign: 'center',
              lineHeight: 1.45,
            }}
          >
            No iterations yet. Click <strong>New prompt</strong> above to start.
          </div>
        ) : (
          iters.map((h) => {
            const active = activeIter === h.id
            return (
              <button
                key={h.id}
                onClick={() => onSelectIter(h.id)}
                style={{
                  width: '100%',
                  padding: '10px 10px',
                  borderRadius: 8,
                  background: active ? 'var(--surface)' : 'transparent',
                  border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
                  boxShadow: active ? 'var(--shadow-1)' : 'none',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                  marginBottom: 2,
                  color: 'var(--ink)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <VerdictDot v={h.traffic_light} />
                  <span
                    className="pc-mono"
                    style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
                  >
                    iter {String(h.iteration_number).padStart(2, '0')}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    className="pc-mono"
                    style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
                  >
                    {formatRelative(h.started_at)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ink)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.4,
                  }}
                >
                  {h.user_prompt}
                </div>
                {(h.total_cost_usd ?? 0) > 0 || h.duration_ms ? (
                  <div className="pc-mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    {h.total_cost_usd ? `$${h.total_cost_usd.toFixed(2)}` : ''}
                    {h.total_cost_usd && h.duration_ms ? ' · ' : ''}
                    {h.duration_ms ? formatDuration(h.duration_ms) : ''}
                  </div>
                ) : null}
              </button>
            )
          })
        )}
      </div>

      {/* Bottom: settings */}
      <div
        style={{
          padding: 10,
          borderTop: '1px solid var(--hairline)',
          display: 'flex',
          gap: 6,
        }}
      >
        <button
          onClick={onOpenSettings}
          className="pc-btn"
          data-variant="ghost"
          data-size="sm"
          style={{ flex: 1, justifyContent: 'flex-start' }}
        >
          <IconSettings size={12} /> Settings
        </button>
      </div>
    </div>
  )
}
