// Top-level App. V0.1 surfaces two top-level tabs once a workspace
// is selected: Workspace (chat) and Settings.

import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace.js'
import { Settings } from '@/components/settings/Settings.js'
import { Workspace } from '@/components/workspace/Workspace.js'
import { Tabs } from '@/components/ui/Tabs.js'
import { Button } from '@/components/ui/Button.js'
import { Input } from '@/components/ui/Input.js'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card.js'

type TopTab = 'workspace' | 'settings'

export function App() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const current = useWorkspaceStore((s) => s.current)
  const refreshWorkspaces = useWorkspaceStore((s) => s.refreshWorkspaces)
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace)
  const loading = useWorkspaceStore((s) => s.loading)
  const [tab, setTab] = useState<TopTab>('workspace')

  // Bootstrap on mount.
  useEffect(() => {
    void (async () => {
      await refreshWorkspaces()
      const first = useWorkspaceStore.getState().workspaces[0]
      if (first && !useWorkspaceStore.getState().current) {
        await selectWorkspace(first.id)
      }
    })()
  }, [refreshWorkspaces, selectWorkspace])

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold tracking-tight">polycoder</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-500">
              v0.1
            </span>
          </div>
          {current ? (
            <div className="flex items-center gap-3">
              <Tabs<TopTab>
                active={tab}
                onChange={setTab}
                items={[
                  { key: 'workspace', label: 'Workspace' },
                  { key: 'settings', label: 'Settings' },
                ]}
                className="border-b-0"
              />
              <span className="text-sm text-slate-600">{current.name}</span>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        {loading && !current ? (
          <div className="text-center text-sm text-slate-500">Loading…</div>
        ) : !current && workspaces.length === 0 ? (
          <CreateFirstWorkspace />
        ) : !current ? (
          <WorkspacePicker />
        ) : tab === 'workspace' ? (
          <Workspace />
        ) : (
          <Settings />
        )}
      </main>
    </div>
  )
}

function CreateFirstWorkspace() {
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace)
  const [name, setName] = useState('My App')
  const [root, setRoot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onPickFolder() {
    setError(null)
    try {
      const picker = (window as unknown as {
        polycoder?: { workspace?: { pickFolder?: (req?: { defaultPath?: string }) => Promise<string | null> } }
      }).polycoder?.workspace?.pickFolder
      if (!picker) {
        setError(
          'Folder picker unavailable. (window.polycoder.workspace.pickFolder is undefined — are you in a regular browser tab?)',
        )
        return
      }
      const picked = await picker()
      if (picked) setRoot(picked)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await createWorkspace(name, root)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your first workspace</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Project name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Where to put your project
            </label>
            <div className="flex gap-2">
              <Input
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="Click 'Pick folder…' →"
                required
                className="flex-1"
              />
              <Button type="button" variant="secondary" onClick={onPickFolder}>
                Pick folder…
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              An empty folder on your computer where polycoder will write the
              code it generates.
            </p>
          </div>
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}
          <Button type="submit" disabled={submitting || !root}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function WorkspacePicker() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const selectWorkspace = useWorkspaceStore((s) => s.selectWorkspace)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pick a workspace</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => selectWorkspace(w.id)}
            className="w-full rounded-md border border-slate-200 px-4 py-3 text-left hover:bg-slate-50"
          >
            <div className="font-medium">{w.name}</div>
            <div className="text-xs text-slate-500">{w.workspace_root}</div>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}
