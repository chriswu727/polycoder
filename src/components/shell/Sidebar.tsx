// Left pane — workspace switcher (top), "New prompt" button, then a
// scrolling list of past iterations for the current workspace, then
// a Settings entry at the bottom.

import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import { formatCost, usePreferencesStore } from '@/stores/preferences.js'
import {
  IconCheck,
  IconChevronDown,
  IconEdit,
  IconMoon,
  IconPlus,
  IconSettings,
  IconSun,
  IconTrash,
  IconX,
  Mark,
} from '@/components/icons.js'

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
  // V2 design: a soft 2px halo of the verdict tone wraps the dot
  // so it's scannable at-a-glance from the sidebar.
  const haloColor =
    v === 'green'
      ? 'var(--green-soft)'
      : v === 'yellow'
        ? 'var(--amber-soft)'
        : v === 'red'
          ? 'var(--red-soft)'
          : 'transparent'
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        display: 'inline-block',
        flex: '0 0 auto',
        boxShadow: v ? `0 0 0 2px ${haloColor}` : 'none',
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
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace)
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace)
  const theme = usePreferencesStore((s) => s.theme)
  const toggleTheme = usePreferencesStore((s) => s.toggleTheme)
  const costFormat = usePreferencesStore((s) => s.costFormat)
  const [wsOpen, setWsOpen] = useState(false)
  const [iters, setIters] = useState<IterationRow[]>([])
  // Inline edit state for the workspace dropdown — these replace
  // window.prompt / window.confirm so the V3 cosmic surface stays
  // intact and Escape / Enter behave the way the user expects from
  // a native macOS app menu, not a 1995 browser dialog.
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [editing, setEditing] = useState<'idle' | 'rename' | 'confirmDelete'>(
    'idle',
  )
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  function resetEdit(): void {
    setEditing('idle')
    setRenameError(null)
  }

  function openRename(): void {
    if (!current) return
    setRenameValue(current.name)
    setRenameError(null)
    setEditing('rename')
    // Focus + select-all next frame, after the input mounts.
    requestAnimationFrame(() => {
      const el = renameInputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    })
  }

  async function commitRename(): Promise<void> {
    if (!current) return
    const next = renameValue.trim()
    if (next === '' || next === current.name) {
      resetEdit()
      return
    }
    try {
      await renameWorkspace(current.id, next)
      resetEdit()
      setWsOpen(false)
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e))
    }
  }

  async function commitDelete(): Promise<void> {
    if (!current) return
    await deleteWorkspace(current.id)
    resetEdit()
    setWsOpen(false)
  }

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
          onClick={() => {
            const next = !wsOpen
            setWsOpen(next)
            if (!next) resetEdit()
          }}
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
            {current && editing === 'idle' ? (
              <>
                <button
                  className="pc-btn"
                  data-variant="ghost"
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={openRename}
                >
                  <IconEdit size={12} /> Rename current project
                </button>
                <button
                  className="pc-btn"
                  data-variant="ghost"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    color: 'var(--red)',
                  }}
                  onClick={() => setEditing('confirmDelete')}
                >
                  <IconTrash size={12} /> Delete current project
                </button>
              </>
            ) : null}
            {current && editing === 'rename' ? (
              <div style={{ padding: '4px 4px 2px' }}>
                <div
                  className="pc-eyebrow"
                  style={{ marginBottom: 6, paddingLeft: 2 }}
                >
                  Rename project
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    ref={renameInputRef}
                    className="pc-input"
                    value={renameValue}
                    onChange={(e) => {
                      setRenameValue(e.target.value)
                      if (renameError) setRenameError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void commitRename()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        resetEdit()
                      }
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="Project name"
                    aria-label="Project name"
                  />
                  <button
                    className="pc-btn"
                    data-size="sm"
                    onClick={() => void commitRename()}
                    aria-label="Save rename"
                    title="Save (Enter)"
                  >
                    <IconCheck size={11} />
                  </button>
                  <button
                    className="pc-btn"
                    data-variant="ghost"
                    data-size="sm"
                    onClick={resetEdit}
                    aria-label="Cancel rename"
                    title="Cancel (Esc)"
                  >
                    <IconX size={11} />
                  </button>
                </div>
                {renameError ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--red)',
                      marginTop: 6,
                      lineHeight: 1.4,
                    }}
                  >
                    {renameError}
                  </div>
                ) : null}
              </div>
            ) : null}
            {current && editing === 'confirmDelete' ? (
              <div style={{ padding: '6px 4px 2px' }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-2)',
                    lineHeight: 1.45,
                    padding: '0 2px 8px',
                  }}
                >
                  Delete <strong>{current.name}</strong>? This removes the
                  workspace + secrets from polycoder. Files on disk stay.
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="pc-btn"
                    data-size="sm"
                    onClick={() => void commitDelete()}
                    style={{
                      flex: 1,
                      justifyContent: 'center',
                      background: 'var(--red)',
                      color: 'white',
                      borderColor: 'var(--red)',
                    }}
                  >
                    <IconTrash size={11} /> Delete
                  </button>
                  <button
                    className="pc-btn"
                    data-variant="ghost"
                    data-size="sm"
                    onClick={resetEdit}
                    style={{ justifyContent: 'center' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
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
                className={active ? 'ws-active' : undefined}
                style={{
                  width: '100%',
                  padding: '10px 10px',
                  borderRadius: 8,
                  background: active ? undefined : 'transparent',
                  border: active ? undefined : '1px solid transparent',
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
                    {h.total_cost_usd ? formatCost(h.total_cost_usd, costFormat) : ''}
                    {h.total_cost_usd && h.duration_ms ? ' · ' : ''}
                    {h.duration_ms ? formatDuration(h.duration_ms) : ''}
                  </div>
                ) : null}
              </button>
            )
          })
        )}
      </div>

      {/* Bottom: settings + theme toggle */}
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
        <button
          onClick={toggleTheme}
          className="pc-btn"
          data-variant="ghost"
          data-size="sm"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          style={{ flex: '0 0 auto', padding: '4px 8px' }}
        >
          {theme === 'dark' ? <IconSun size={13} /> : <IconMoon size={13} />}
        </button>
      </div>
    </div>
  )
}
