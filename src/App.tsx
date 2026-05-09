// V0.2 frontend rewrite — design from claude.ai/design package.
//
// Surface routing:
//   no workspaces yet                    → FirstRun centered card
//   workspaces but none selected         → WorkspacePicker centered list
//   tab = settings                       → Sidebar | Settings shell
//   otherwise (tab = workspace)          → Sidebar | Chat | Preview/Result
//
// Title bar at the top (drag region for the OS window) is shown
// over all surfaces. The whole app is wrapped in `data-theme`
// (light/dark) which the design tokens key off.

import { useEffect, useState } from 'react'
import type { FC } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import { FirstRun } from '@/components/setup/FirstRun.js'
import { WorkspaceShell } from '@/components/shell/WorkspaceShell.js'
import { Settings } from '@/components/settings/Settings.js'
import { Sidebar } from '@/components/shell/Sidebar.js'
import { Mark } from '@/components/icons.js'

type TopTab = 'workspace' | 'settings'

// Note: the V0.2 design package included an in-app titlebar with
// fake macOS traffic-light dots — that was a "screenshot frame"
// for the canvas-style design canvas. In the real Electron app
// the OS provides its own titlebar, so we don't render one here.
// We do mirror the workspace name into document.title so macOS's
// native window title shows "polycoder · <project>".

const WorkspacePicker: FC<{ onCreate: () => void }> = ({ onCreate }) => {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace)

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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 24,
          }}
        >
          <Mark size={28} />
          <div>
            <div
              style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}
            >
              Pick a project
            </div>
            <div
              style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}
            >
              Or create a new one.
            </div>
          </div>
        </div>

        <div className="pc-card" style={{ padding: 12 }}>
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => void selectWorkspace(w.id)}
              className="pc-btn"
              data-variant="ghost"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                padding: '10px 12px',
                marginBottom: 4,
                gap: 10,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--border-strong)',
                }}
              />
              <span style={{ flex: 1, textAlign: 'left' }}>{w.name}</span>
              <span
                className="pc-mono"
                style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
              >
                {new Date(w.created_at).toLocaleDateString()}
              </span>
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--hairline)', margin: '6px 0' }} />
          <button
            onClick={onCreate}
            className="pc-btn"
            data-variant="primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
          >
            Create new project
          </button>
        </div>
      </div>
    </div>
  )
}

export function App(): React.ReactElement {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const current = useWorkspaceStore((s) => s.current)
  const refreshWorkspaces = useWorkspaceStore((s) => s.refreshWorkspaces)
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace)
  const [tab, setTab] = useState<TopTab>('workspace')
  const [forceFirstRun, setForceFirstRun] = useState(false)

  useEffect(() => {
    void (async (): Promise<void> => {
      await refreshWorkspaces()
      const first = useWorkspaceStore.getState().workspaces[0]
      if (first && !useWorkspaceStore.getState().current) {
        await selectWorkspace(first.id)
      }
    })()
  }, [refreshWorkspaces, selectWorkspace])

  // Apply theme. Default light; later commits will surface a toggle
  // somewhere in Settings or the title bar. The class is on <html>
  // so the design tokens cascade everywhere.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light')
  }, [])

  // Mirror current workspace name into the OS window title.
  useEffect(() => {
    document.title = current ? `polycoder · ${current.name}` : 'polycoder'
  }, [current])

  const showFirstRun = forceFirstRun || workspaces.length === 0

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
      }}
    >
      {showFirstRun ? (
        <FirstRun />
      ) : !current ? (
        <WorkspacePicker onCreate={() => setForceFirstRun(true)} />
      ) : tab === 'settings' ? (
        <div
          className="panes"
          style={{
            display: 'grid',
            gridTemplateColumns: '232px 1fr',
            flex: 1,
            minHeight: 0,
          }}
        >
          <Sidebar
            activeIter={null}
            onSelectIter={() => setTab('workspace')}
            onNewPrompt={() => setTab('workspace')}
            onOpenSettings={() => setTab('settings')}
            onCreateWorkspace={() => setForceFirstRun(true)}
          />
          <Settings />
        </div>
      ) : (
        <WorkspaceShell
          onOpenSettings={() => setTab('settings')}
          onCreateWorkspace={() => setForceFirstRun(true)}
        />
      )}
    </div>
  )
}
