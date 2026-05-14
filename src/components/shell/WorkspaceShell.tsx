// Three-pane layout: sidebar (history) | chat | right column
// (progress / result / preview).
//
// Active when a workspace is selected and the Settings tab is not
// open. Owns the lightweight UI state of "which iteration is being
// viewed" — the in-flight iteration is the current store state;
// clicking a past iteration in the sidebar reloads its result.

import { useEffect, useState } from 'react'
import type { FC } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import { useIterationStore } from '@/stores/iteration.js'

import { Sidebar } from './Sidebar.js'
import { ProducerChat } from './ProducerChat.js'
import { TeamMeetingRoom } from '@/components/workspace/TeamMeetingRoom.js'
import { IterationResult } from '@/components/workspace/IterationResult.js'
import { PreviewPane, type PreviewState } from '@/components/workspace/PreviewPane.js'
import { CodeBrowser } from '@/components/workspace/CodeBrowser.js'
import { WebContainerHost } from '@/components/workspace/WebContainerHost.js'
import { Gallery } from '@/components/workspace/Gallery.js'

// The old IdleChat hero + ChatBody / CompletedTeamBubble /
// detectPresetLabel rendered the pre-Producer chat flow.
// ProducerChat (src/components/shell/ProducerChat.tsx) now owns the
// whole user-message surface — it handles greeting, conversation,
// and dispatch in one place.

export const WorkspaceShell: FC<{ onOpenSettings: () => void; onCreateWorkspace: () => void }> =
  ({ onOpenSettings, onCreateWorkspace }) => {
    const current = useWorkspaceStore((s) => s.current)
    const status = useIterationStore((s) => s.status)
    const result = useIterationStore((s) => s.result)
    const iterationNumber = useIterationStore((s) => s.iteration_number)
    const abort = useIterationStore((s) => s.abort)
    const reset = useIterationStore((s) => s.reset)
    const bootstrap = useIterationStore((s) => s.bootstrap)
    const [activeIter, setActiveIter] = useState<string | null>(null)
    const [rightTab, setRightTab] = useState<
      'preview' | 'code' | 'sandbox' | 'gallery'
    >('preview')

    useEffect(() => {
      const off = bootstrap(() => useWorkspaceStore.getState().current?.id ?? null)
      return off
    }, [bootstrap])

    if (!current) return null

    // Right pane only appears once there's something to show.
    // Before the first prompt, the layout is two panes only —
    // sidebar + chat-takes-the-rest. The "Your app will appear here"
    // placeholder is informationless when nothing's started, so
    // claiming half the screen is wasteful.
    const hasIterationActivity = status !== 'idle' || !!result

    const iterationId = useIterationStore.getState().iteration_id
    const previewState: PreviewState =
      status === 'running'
        ? { kind: 'building' }
        : status === 'failed'
          ? { kind: 'failed-show-prior' }
          : status === 'completed' || status === 'aborted'
            ? {
                kind: 'ready',
                iterLabel: `iter ${String(iterationNumber ?? 0).padStart(2, '0')} · index.html`,
                ...(iterationId ? { reloadKey: iterationId } : {}),
              }
            : { kind: 'empty-idle' }

    return (
      <div
        className="panes"
        style={{
          display: 'grid',
          gridTemplateColumns: hasIterationActivity ? '232px 1fr 1fr' : '232px 1fr',
          flex: 1,
          minHeight: 0,
        }}
      >
        <Sidebar
          activeIter={activeIter}
          onSelectIter={(id) => {
            setActiveIter(id)
            void useIterationStore.getState().loadPast(id)
          }}
          onNewPrompt={() => {
            setActiveIter(null)
            reset()
          }}
          onOpenSettings={onOpenSettings}
          onCreateWorkspace={onCreateWorkspace}
        />

        <div
          className="pane pane-chat"
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <ProducerChat />
        </div>

        {hasIterationActivity ? (
          <div
            className="pane pane-preview fade-up"
            style={{ borderLeft: '1px solid var(--hairline)' }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateRows: '1.1fr 1fr',
                height: '100%',
              }}
            >
              <div
                style={{
                  overflow: 'hidden',
                  borderBottom: '1px solid var(--hairline)',
                  background: 'var(--bg)',
                }}
              >
                {status === 'running' ? (
                  <TeamMeetingRoom
                    onAbort={() => {
                      if (current) void abort(current.id)
                    }}
                  />
                ) : (
                  <IterationResult />
                )}
              </div>
              <div
                style={{
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Preview / Code tab strip. The preview iframe shows
                 *  the running app; the code browser shows the
                 *  workspace files the pipeline produced. Vibe coders
                 *  want both. */}
                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    padding: '6px 8px',
                    background: 'var(--bg-2)',
                    borderBottom: '1px solid var(--hairline)',
                  }}
                  role="tablist"
                  aria-label="Right pane mode"
                >
                  {(['preview', 'code', 'sandbox', 'gallery'] as const).map(
                    (t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={rightTab === t}
                        onClick={() => setRightTab(t)}
                        className="pc-mono"
                        style={{
                          padding: '3px 10px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 500,
                          border: '1px solid',
                          borderColor:
                            rightTab === t ? 'var(--border)' : 'transparent',
                          cursor: 'pointer',
                          background:
                            rightTab === t ? 'var(--surface)' : 'transparent',
                          color:
                            rightTab === t ? 'var(--ink)' : 'var(--ink-3)',
                          boxShadow:
                            rightTab === t ? 'var(--shadow-1)' : 'none',
                          textTransform: 'capitalize',
                        }}
                      >
                        {t === 'preview'
                          ? '预览'
                          : t === 'code'
                            ? '代码'
                            : t === 'sandbox'
                              ? '沙盒'
                              : '作品集'}
                      </button>
                    ),
                  )}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  {rightTab === 'gallery' ? (
                    <Gallery
                      onSelectIteration={(id) => {
                        setActiveIter(id)
                        void useIterationStore.getState().loadPast(id)
                      }}
                    />
                  ) : rightTab === 'sandbox' ? (
                    <WebContainerHost />
                  ) : rightTab === 'preview' ? (
                    <PreviewPane state={previewState} />
                  ) : (
                    <CodeBrowser />
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }
