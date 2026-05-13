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
import {
  Chorus,
  IconArrowRight,
  Mark,
  MissionDashboard,
  MissionLanding,
  MissionNotes,
  MissionTodo,
  VerdictPlanet,
} from '@/components/icons.js'
import type { FC as FCType } from 'react'
import type { CommunicatorPayload } from '@core/types/payloads/communicator.js'

type SamplePrompt = {
  key: 'todo' | 'landing' | 'dashboard' | 'notes'
  label: string
  hint: string
  Glyph: FCType<{ size?: number | undefined }>
}

const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    key: 'todo',
    label: 'A simple to-do list',
    hint: 'Categories, due dates, saves automatically.',
    Glyph: MissionTodo,
  },
  {
    key: 'landing',
    label: 'A SaaS landing page',
    hint: 'Hero, features, pricing, footer.',
    Glyph: MissionLanding,
  },
  {
    key: 'dashboard',
    label: 'A sales dashboard',
    hint: 'KPIs, table, mini chart.',
    Glyph: MissionDashboard,
  },
  {
    key: 'notes',
    label: 'A markdown notes app',
    hint: 'Live preview, side-by-side editor.',
    Glyph: MissionNotes,
  },
]

const VERDICT_BUBBLE_LABEL: Record<'green' | 'yellow' | 'red', string> = {
  green: 'Looks good',
  yellow: 'Built, with notes',
  red: 'Needs your input',
}

const IdleChat: FC<{ onSend: (text: string) => void }> = ({ onSend }) => {
  // V3 cosmic hero: brand mark + wordmark + chorus eyebrow + a
  // 56px asking-headline, then 4 mission-glyph cards. Picks 3
  // out of 4 sample prompts so the layout breathes.
  const visiblePrompts = SAMPLE_PROMPTS.slice(0, 3)
  return (
    <div style={{ paddingTop: 36, maxWidth: 540 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 32,
        }}
      >
        <Mark size={22} />
        <span className="pc-wordmark" style={{ fontSize: 17, lineHeight: 1 }}>
          polycoder
        </span>
        <span
          style={{
            width: 1,
            height: 12,
            background: 'var(--border)',
            margin: '0 2px',
          }}
        />
        <span
          className="pc-mono"
          style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
        >
          today
        </span>
        <span style={{ flex: 1 }} />
        <span
          className="pc-mono"
          style={{
            fontSize: 10,
            color: 'var(--ink-3)',
            letterSpacing: '0.04em',
          }}
        >
          /{new Date().getFullYear()}
        </span>
      </div>
      <div className="pc-bracket-eyebrow" style={{ marginBottom: 14 }}>
        <span>[</span>
        <span>8 roles · one team</span>
        <span>]</span>
      </div>
      <div
        style={{
          fontSize: 56,
          fontWeight: 700,
          letterSpacing: '-0.030em',
          lineHeight: 1.0,
          marginBottom: 16,
          color: 'var(--ink)',
        }}
      >
        What should we make today?
      </div>
      <div
        style={{
          fontSize: 14,
          color: 'var(--ink-2)',
          marginBottom: 28,
          lineHeight: 1.55,
        }}
      >
        Tell us in plain words — no code needed. Your team of 8 will figure
        out how to build it.
      </div>

      <div className="pc-eyebrow" style={{ marginBottom: 10 }}>
        Or start from one of these:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visiblePrompts.map((s) => {
          const Glyph = s.Glyph
          return (
            <button
              key={s.key}
              onClick={() => onSend(s.label)}
              className="pc-prompt-card"
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  background: 'var(--surface-2)',
                  color: 'var(--ink-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: '0 0 auto',
                  border: '1px solid var(--border)',
                }}
              >
                <Glyph size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--ink-3)',
                    marginTop: 1,
                  }}
                >
                  {s.hint}
                </div>
              </div>
              <IconArrowRight
                size={12}
                style={{ color: 'var(--ink-3)', flex: '0 0 auto' }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

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
            gap: 10,
            marginBottom: 12,
            alignItems: 'center',
            padding: '10px 12px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
          }}
        >
          <Chorus pulse size={6} />
          <div style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)' }}>
            Your team is talking it through.{' '}
            <span style={{ color: 'var(--ink-3)' }}>5-15 minutes typical.</span>
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
        <VerdictPlanet verdict={verdict} size={28} />
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

    // Right pane only appears once there's something to show.
    // Before the first prompt, the layout is two panes only —
    // sidebar + chat-takes-the-rest. The "Your app will appear here"
    // placeholder is informationless when nothing's started, so
    // claiming half the screen is wasteful.
    const hasIterationActivity = status !== 'idle' || !!result

    const previewState: PreviewState =
      status === 'running'
        ? { kind: 'building' }
        : status === 'failed'
          ? { kind: 'failed-show-prior' }
          : status === 'completed' || status === 'aborted'
            ? {
                kind: 'ready',
                iterLabel: `iter ${String(iterationNumber ?? 0).padStart(2, '0')} · index.html`,
              }
            : { kind: 'empty-idle' }

    const presetLabel = detectPresetLabel(roleAssignments)

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
                  <RolePipelineProgress
                    onAbort={() => {
                      if (current) void abort(current.id)
                    }}
                  />
                ) : (
                  <IterationResult />
                )}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <PreviewPane state={previewState} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }
