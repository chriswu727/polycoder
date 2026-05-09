// First-run screen — shown when no workspaces exist yet. The user
// names their project and picks (via native folder picker) where
// it should live on disk. Centered card layout from the V0.2
// design.
//
// Replaces the V0.1 CreateFirstWorkspace inline form with the
// design's card-on-warm-background pattern + soft-technical
// language ("Where to put your project" not "absolute path").

import { useState } from 'react'
import type { FC } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import {
  Mark,
  IconArrowRight,
  IconCheck,
  IconFolder,
  IconLock,
} from '@/components/icons.js'

export const FirstRun: FC = () => {
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace)
  const [name, setName] = useState('Daily todo')
  const [folder, setFolder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onPickFolder(): Promise<void> {
    setError(null)
    try {
      const picker = (
        window as unknown as {
          polycoder?: {
            workspace?: {
              pickFolder?: (req?: {
                defaultPath?: string
              }) => Promise<string | null>
            }
          }
        }
      ).polycoder?.workspace?.pickFolder
      if (!picker) {
        setError(
          'Folder picker unavailable. (window.polycoder.workspace.pickFolder is undefined — are you running in a browser tab?)',
        )
        return
      }
      const picked = await picker()
      if (picked) setFolder(picked)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await createWorkspace(name, folder)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canCreate = Boolean(name.trim() && folder)

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        overflow: 'auto',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Mark size={32} />
          <div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: '-0.015em',
              }}
            >
              Welcome to polycoder
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
              Your studio team, in a desktop app.
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="pc-card" style={{ padding: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
            Start a project
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--ink-2)',
              marginBottom: 18,
              lineHeight: 1.5,
            }}
          >
            Pick a name and a place on your computer for it to live. Everything
            stays on this machine.
          </div>

          <label style={{ display: 'block', marginBottom: 14 }}>
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--ink-2)',
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              Project name
            </div>
            <input
              className="pc-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily todo"
              required
            />
          </label>

          <label style={{ display: 'block', marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--ink-2)',
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              Where to put your project
            </div>
            <button
              type="button"
              onClick={onPickFolder}
              className="pc-btn"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                background: folder ? 'var(--surface)' : 'var(--surface-2)',
              }}
            >
              <IconFolder size={14} />
              <span
                style={{
                  flex: 1,
                  textAlign: 'left',
                  color: folder ? 'var(--ink)' : 'var(--ink-3)',
                }}
                className={folder ? 'pc-mono' : ''}
              >
                {folder || 'Choose a folder…'}
              </span>
              {folder ? <IconCheck size={12} /> : null}
            </button>
            <div
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                marginTop: 6,
                display: 'flex',
                gap: 6,
                alignItems: 'flex-start',
              }}
            >
              <IconLock size={11} /> Stored only on your computer. polycoder
              won't sync this anywhere.
            </div>
          </label>

          {error ? (
            <div
              style={{
                marginBottom: 14,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--red-soft)',
                color: 'var(--red)',
                border: '1px solid oklch(from var(--red) l c h / 0.2)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            className="pc-btn"
            data-variant="primary"
            data-size="lg"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={!canCreate || submitting}
          >
            {submitting ? 'Creating…' : 'Create project'} <IconArrowRight size={12} />
          </button>
        </form>
      </div>
    </div>
  )
}
