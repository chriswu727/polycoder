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
import { ChatBubble, ChatComposer, ChatPane } from './ChatPane.js'
import { RolePipelineProgress } from '@/components/workspace/RolePipelineProgress.js'
import { IterationResult } from '@/components/workspace/IterationResult.js'
import { PreviewPane, type PreviewState } from '@/components/workspace/PreviewPane.js'
import { VerdictOrb } from '@/components/workspace/VerdictOrb.js'
import { IconSparkle, IconArrowRight, Mark } from '@/components/icons.js'
import type { CommunicatorPayload } from '@core/types/payloads/communicator.js'

const SAMPLE_PROMPTS: { label: string; hint: string }[] = [
  { label: 'A simple to-do list', hint: 'Categories, due dates, persists locally.' },
  { label: 'A SaaS landing page', hint: 'Hero, features, pricing, footer.' },
  { label: 'A sales dashboard', hint: 'KPIs, table, mini chart.' },
]

const VERDICT_BUBBLE_LABEL: Record<'green' | 'yellow' | 'red', string> = {
  green: 'Looks good',
  yellow: 'Built, with notes',
  red: 'Needs your input',
}

const IdleChat: FC<{ onSend: (text: string) => void }> = ({ onSend }) => (
  <div style={{ paddingTop: 24 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <Mark size={20} />
      <div className="pc-eyebrow">today</div>
    </div>
    <div
      style={{
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: '-0.015em',
        marginBottom: 4,
      }}
    >
      Ready when you are
    </div>
    <div
      style={{
        fontSize: 13,
        color: 'var(--ink-2)',
        marginBottom: 22,
        lineHeight: 1.5,
      }}
    >
      Describe what you'd like to build. Your team will take it from there.
    </div>

    <div className="pc-eyebrow" style={{ marginBottom: 8 }}>
      Or try one of these:
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {SAMPLE_PROMPTS.map((s, i) => (
        <button
          key={i}
          onClick={() => onSend(s.label)}
          className="pc-btn"
          data-variant="ghost"
          style={{
            justifyContent: 'flex-start',
            gap: 10,
            padding: '11px 12px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-1)',
            textAlign: 'left',
          }}
        >
          <IconSparkle size={13} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>
              {s.label}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>
              {s.hint}
            </div>
          </div>
          <IconArrowRight size={11} style={{ color: 'var(--ink-3)' }} />
        </button>
      ))}
    </div>
  </div>
)

const ChatBody: FC = () => {
  const status = useIterationStore((s) => s.status)
  const result = useIterationStore((s) => s.result)
  const userPrompt = useIterationStore((s) => s.user_prompt)
  const iterationNumber = useIterationStore((s) => s.iteration_number)
  const sendStart = useIterationStore((s) => s.start)
  const currentWs = useWorkspaceStore((s) => s.current)

  const onSend = (text: string): void => {
    if (!currentWs) return
    void sendStart(currentWs.id, text)
  }

  if (status === 'idle' && !result) {
    return <IdleChat onSend={onSend} />
  }

  return (
    <>
      {userPrompt ? <ChatBubble from="user">{userPrompt}</ChatBubble> : null}

      {status === 'running' ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 12,
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconSparkle size={11} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            Your team is on it. <span className="pc-mono" style={{ color: 'var(--ink-3)' }}>5-15 minutes typical.</span>
          </div>
        </div>
      ) : null}

      {(status === 'completed' || status === 'aborted') && result?.status === 'completed' ? (
        <CompletedTeamBubble
          verdict={result.traffic_light}
          iterationNumber={iterationNumber}
          payload={result.role_outputs.communicator?.payload as CommunicatorPayload | undefined}
        />
      ) : null}

      {status === 'failed' && result?.status === 'failed' ? (
        <ChatBubble
          from="team"
          meta={`iter ${String(iterationNumber ?? 0).padStart(2, '0')} · stopped`}
        >
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            I stopped before burning more credits. The full breakdown is on the
            right — including what to try next.
          </div>
        </ChatBubble>
      ) : null}
    </>
  )
}

const CompletedTeamBubble: FC<{
  verdict: 'green' | 'yellow' | 'red'
  iterationNumber: number | null
  payload: CommunicatorPayload | undefined
}> = ({ verdict, iterationNumber, payload }) => {
  const label = VERDICT_BUBBLE_LABEL[verdict]
  return (
    <ChatBubble
      from="team"
      meta={`iter ${String(iterationNumber ?? 0).padStart(2, '0')} · ${label}`}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <VerdictOrb verdict={verdict} size={22} />
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
      </div>
      {payload?.user_facing_text ? (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--ink-2)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {payload.user_facing_text.length > 280
            ? payload.user_facing_text.slice(0, 280).trimEnd() + '…'
            : payload.user_facing_text}
        </div>
      ) : null}
    </ChatBubble>
  )
}

function detectPresetLabel(
  roleAssignments:
    | Record<string, { model_id: string | null; secret_id: string | null }>
    | null,
): string | null {
  // Quick heuristic: if all 8 roles have a model_id assigned, label
  // as the preset most likely matching. We just count "all set" vs
  // not. Real preset detection (matching against PRESET assignments)
  // would need the preset definitions imported; deferred.
  if (!roleAssignments) return null
  const total = Object.keys(roleAssignments).length
  const set = Object.values(roleAssignments).filter((a) => a.secret_id && a.model_id).length
  if (total > 0 && set === total) return 'Custom'
  return null
}

export const WorkspaceShell: FC<{ onOpenSettings: () => void; onCreateWorkspace: () => void }> =
  ({ onOpenSettings, onCreateWorkspace }) => {
    const current = useWorkspaceStore((s) => s.current)
    const roleAssignments = useWorkspaceStore((s) => s.roleAssignments)
    const status = useIterationStore((s) => s.status)
    const result = useIterationStore((s) => s.result)
    const iterationNumber = useIterationStore((s) => s.iteration_number)
    const abort = useIterationStore((s) => s.abort)
    const reset = useIterationStore((s) => s.reset)
    const bootstrap = useIterationStore((s) => s.bootstrap)
    const [activeIter, setActiveIter] = useState<string | null>(null)

    useEffect(() => {
      const off = bootstrap(() => useWorkspaceStore.getState().current?.id ?? null)
      return off
    }, [bootstrap])

    if (!current) return null

    const previewState: PreviewState =
      status === 'idle' && !result
        ? { kind: 'empty-idle' }
        : status === 'running'
          ? { kind: 'building' }
          : status === 'failed'
            ? { kind: 'failed-show-prior' }
            : status === 'completed' || status === 'aborted'
              ? {
                  kind: 'ready',
                  iterLabel: `iter ${String(iterationNumber ?? 0).padStart(2, '0')} · index.html`,
                }
              : { kind: 'empty-idle' }

    const showProgressOrResult = status !== 'idle' || !!result
    const presetLabel = detectPresetLabel(roleAssignments)

    return (
      <div className="panes" style={{ display: 'grid', gridTemplateColumns: '232px 1fr 1fr', flex: 1, minHeight: 0 }}>
        <Sidebar
          activeIter={activeIter}
          onSelectIter={(id) => setActiveIter(id)}
          onNewPrompt={() => reset()}
          onOpenSettings={onOpenSettings}
          onCreateWorkspace={onCreateWorkspace}
        />

        <ChatPane
          footer={
            <ChatComposer
              onSend={(text) => {
                if (!current) return
                void useIterationStore.getState().start(current.id, text)
              }}
              disabled={status === 'running'}
              {...(presetLabel ? { presetLabel } : {})}
            />
          }
        >
          <ChatBody />
        </ChatPane>

        <div
          className="pane pane-preview"
          style={{ borderLeft: '1px solid var(--hairline)' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateRows: showProgressOrResult ? '1.1fr 1fr' : '1fr',
              height: '100%',
            }}
          >
            {showProgressOrResult ? (
              <div
                style={{
                  overflow: 'hidden',
                  borderBottom: '1px solid var(--hairline)',
                  background: 'var(--bg)',
                }}
              >
                {status === 'running' ? (
                  <RolePipelineProgress
                    onAbort={() => {
                      if (current) void abort(current.id)
                    }}
                  />
                ) : (
                  <IterationResult />
                )}
              </div>
            ) : null}
            <div style={{ overflow: 'hidden' }}>
              <PreviewPane state={previewState} />
            </div>
          </div>
        </div>
      </div>
    )
  }
