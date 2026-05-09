// Vertical timeline of the 8 roles. Per design, this is the
// progress visualization for an in-flight iteration — replaces a
// generic spinner. As each role finishes, its row gets a checkmark
// and a one-line message describing what it did.
//
// Friendly role labels (Understanding / Sketching / Planning /
// Writing / Double-checking / Reviewing / Testing / Wrapping up)
// match the design + the V0.1.1 store error translations.

import type { FC } from 'react'

import type { RoleType } from '@core/types/role.js'
import { useIterationStore } from '@/stores/iteration.js'
import { ROLE_ICONS, IconCheck, IconX, IconSparkle, IconStop } from '@/components/icons.js'
import { ROLE_LABEL, hueFor, roleSwatches } from '@/components/role-palette.js'

const ROLE_ORDER: RoleType[] = [
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
]

type RowStatus = 'idle' | 'running' | 'completed' | 'failed'

const TimelineRow: FC<{
  role: RoleType
  status: RowStatus
  isLast: boolean
  detail?: string | undefined
}> = ({ role, status, isLast, detail }) => {
  const Icon = ROLE_ICONS[role]
  const isRunning = status === 'running'
  const isDone = status === 'completed'
  const isFailed = status === 'failed'
  const isPending = status === 'idle'

  const hue = hueFor(role)
  const swatch = roleSwatches(hue)
  // V2 design: each role's identity color leaks into the regular run.
  // Avatar palette switches by status; failed always uses the system
  // red so it stays unambiguous.
  let avatarBg: string
  let avatarFg: string
  let avatarBorder: string
  if (isDone) {
    avatarBg = swatch.soft
    avatarFg = swatch.base
    avatarBorder = swatch.border
  } else if (isFailed) {
    avatarBg = 'var(--red-soft)'
    avatarFg = 'var(--red)'
    avatarBorder = 'oklch(from var(--red) l c h / 0.45)'
  } else if (isRunning) {
    avatarBg = swatch.soft
    avatarFg = swatch.base
    avatarBorder = swatch.base
  } else {
    avatarBg = 'var(--surface-2)'
    avatarFg = 'var(--ink-3)'
    avatarBorder = 'var(--border)'
  }

  return (
    <div style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: isLast ? 0 : 14 }}>
      {!isLast ? (
        <div
          style={{
            position: 'absolute',
            left: 13.5,
            top: 28,
            bottom: 0,
            width: 1,
            background: isDone ? swatch.border : 'var(--hairline)',
          }}
        />
      ) : null}

      <div style={{ position: 'relative', flex: '0 0 auto' }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: avatarBg,
            color: avatarFg,
            border: '1px solid ' + avatarBorder,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition:
              'background 200ms ease, color 200ms ease, border-color 200ms ease',
          }}
        >
          {isDone ? <IconCheck size={14} /> : isFailed ? <IconX size={14} /> : <Icon size={14} />}
        </div>
        {isRunning ? (
          <div
            style={{
              position: 'absolute',
              inset: -2,
              borderRadius: 10,
              border: '1.5px solid ' + swatch.base,
              animation: 'pc-pulse-ring 1.6s ease-out infinite',
              pointerEvents: 'none',
            }}
          />
        ) : null}
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: isPending ? 'var(--ink-3)' : 'var(--ink)',
            }}
          >
            {ROLE_LABEL[role]}
          </div>
          <div
            className="pc-mono"
            style={{ fontSize: 10.5, color: 'var(--ink-3)', flex: '0 0 auto' }}
          >
            {isRunning ? <span style={{ color: swatch.base }}>· running</span> : null}
            {isPending ? <span>queued</span> : null}
            {isFailed ? <span style={{ color: 'var(--red)' }}>failed</span> : null}
          </div>
        </div>
        {detail ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-2)',
              marginTop: 3,
              lineHeight: 1.45,
            }}
          >
            {detail}
          </div>
        ) : null}
        {isRunning && !detail ? (
          <div
            style={{
              marginTop: 6,
              height: 2,
              borderRadius: 2,
              background: 'var(--surface-2)',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '40%',
                height: '100%',
                background: swatch.base,
                animation: 'pc-progress-indeterminate 1.6s ease-in-out infinite',
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const RolePipelineProgress: FC<{ onAbort?: () => void }> = ({ onAbort }) => {
  const status = useIterationStore((s) => s.status)
  const roleProgress = useIterationStore((s) => s.roleProgress)
  const cost = useIterationStore((s) => s.cumulativeCostUsd)

  if (status === 'idle') return null

  const completedCount = ROLE_ORDER.filter(
    (r) => roleProgress[r]?.status === 'completed',
  ).length
  const runningRole = ROLE_ORDER.find((r) => roleProgress[r]?.status === 'running')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--hairline)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconSparkle size={14} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>Your team is on it</div>
          <div
            className="pc-mono"
            style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2 }}
          >
            step {Math.min(completedCount + 1, ROLE_ORDER.length)} of {ROLE_ORDER.length} · $
            {cost.toFixed(2)} so far
          </div>
        </div>
        {onAbort && status === 'running' ? (
          <button className="pc-btn" data-size="sm" onClick={onAbort}>
            <IconStop size={11} /> Stop
          </button>
        ) : null}
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {ROLE_ORDER.map((role, i) => {
          const rp = roleProgress[role]
          const rowStatus: RowStatus =
            rp?.status === 'completed'
              ? 'completed'
              : rp?.status === 'running'
                ? 'running'
                : rp?.status === 'failed'
                  ? 'failed'
                  : 'idle'

          // Detail line: model on completed rows, error detail on
          // failed, nothing while running (we show the indeterminate
          // bar instead).
          let detail: string | undefined
          if (rowStatus === 'completed' && rp?.model) detail = rp.model
          if (rowStatus === 'failed' && rp?.errorDetail) {
            detail = rp.errorDetail.slice(0, 200)
          }
          // Highlight the running role with no detail (bar takes over).

          return (
            <TimelineRow
              key={role}
              role={role}
              status={rowStatus}
              isLast={i === ROLE_ORDER.length - 1}
              detail={detail}
            />
          )
        })}
      </div>

      {runningRole ? (
        <div
          style={{
            padding: '8px 16px 12px',
            fontSize: 11.5,
            color: 'var(--ink-3)',
            borderTop: '1px solid var(--hairline)',
            background: 'var(--bg-2)',
          }}
        >
          This usually takes 5-15 minutes. You can step away — we'll keep working.
        </div>
      ) : null}
    </div>
  )
}
