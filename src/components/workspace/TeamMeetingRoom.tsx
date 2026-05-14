// TeamMeetingRoom — the visible "我在指挥一支 AI 团队" surface.
//
// Replaces the flat RolePipelineProgress timeline with a meeting-
// room layout: Producer (项目经理) at the top-center as the
// orchestrator, 8 role specialists arranged in a 4×2 grid below.
// Each role card carries:
//   - mascot icon in role hue
//   - Chinese label (需求翻译师 / 设计师 / ...)
//   - status badge (待命 / 进行中 / 已完成 / 跳过 / 失败)
//   - model attribution chip (e.g. "DeepSeek-Chat") when it ran
//
// Wires to useIterationStore — each role_started / role_completed /
// role_failed pipeline event flips the card state. When no iteration
// is running, the room is "team standby" (all cards quiet).
//
// This is the polycoder visual differentiation kernel — vibe coders
// see 8 AIs activating in real time, not a generic loading spinner.

import type { FC } from 'react'

import type { RoleType } from '@core/types/role.js'
import { useIterationStore } from '@/stores/iteration.js'
import { formatCost, usePreferencesStore } from '@/stores/preferences.js'
import {
  IconCheck,
  IconSparkle,
  IconStop,
  IconX,
  ROLE_ICONS,
} from '@/components/icons.js'
import {
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  hueFor,
  roleSwatches,
} from '@/components/role-palette.js'

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

type RowStatus = 'idle' | 'running' | 'completed' | 'failed' | 'retried'

export const TeamMeetingRoom: FC<{ onAbort?: () => void }> = ({ onAbort }) => {
  const status = useIterationStore((s) => s.status)
  const mode = useIterationStore((s) => s.mode)
  const roleProgress = useIterationStore((s) => s.roleProgress)
  const cost = useIterationStore((s) => s.cumulativeCostUsd)
  const costFormat = usePreferencesStore((s) => s.costFormat)

  // For Quick Edit, only Coder runs — show a slim variant.
  if (mode === 'quick' && status === 'running') {
    return (
      <QuickEditStandby cost={cost} costFormat={costFormat} onAbort={onAbort} />
    )
  }

  if (status === 'idle') {
    return <RoomEmpty />
  }

  const completedCount = ROLE_ORDER.filter(
    (r) => roleProgress[r]?.status === 'completed',
  ).length
  const runningRole = ROLE_ORDER.find(
    (r) => roleProgress[r]?.status === 'running',
  )

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <ProducerSeat
        runningRole={runningRole}
        completedCount={completedCount}
        cost={cost}
        costFormat={costFormat}
        onAbort={status === 'running' ? onAbort : undefined}
      />

      <div
        className="scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 14px 16px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          alignContent: 'start',
        }}
      >
        {ROLE_ORDER.map((role) => {
          const rp = roleProgress[role]
          const rowStatus: RowStatus =
            rp?.status === 'completed'
              ? 'completed'
              : rp?.status === 'running'
                ? 'running'
                : rp?.status === 'failed'
                  ? 'failed'
                  : rp?.status === 'retried'
                    ? 'retried'
                    : 'idle'
          return (
            <RoleCard
              key={role}
              role={role}
              status={rowStatus}
              model={rp?.model}
              errorDetail={rp?.errorDetail}
            />
          )
        })}
      </div>

      {status === 'running' ? (
        <div
          style={{
            padding: '8px 16px 12px',
            fontSize: 11,
            color: 'var(--ink-3)',
            borderTop: '1px solid var(--hairline)',
            background: 'var(--bg-2)',
          }}
        >
          团队会议进行中——这一轮要 4-15 分钟。可以先去做别的事，做完会通知你。
        </div>
      ) : null}
    </div>
  )
}

// ─── Producer seat (head of the room) ───────────────────────────────

const ProducerSeat: FC<{
  runningRole: RoleType | undefined
  completedCount: number
  cost: number
  costFormat: 'friendly' | 'dollars'
  onAbort?: (() => void) | undefined
}> = ({ runningRole, completedCount, cost, costFormat, onAbort }) => (
  <div
    style={{
      padding: '14px 16px',
      borderBottom: '1px solid var(--hairline)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'var(--bg-2)',
    }}
  >
    <div
      style={{
        position: 'relative',
        flex: '0 0 auto',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background:
            'linear-gradient(135deg, oklch(0.65 0.18 280), oklch(0.55 0.20 250))',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 14px oklch(0.55 0.20 250 / 0.35)',
        }}
      >
        <IconSparkle size={16} />
      </div>
      {runningRole ? (
        <div
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: 12,
            border: '1.5px solid oklch(0.65 0.18 280)',
            animation: 'pc-pulse-ring 1.6s ease-out infinite',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>项目经理 · 团队会议</div>
      <div
        className="pc-mono"
        style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}
      >
        {runningRole
          ? `轮到 ${ROLE_LABEL[runningRole]} · 已完成 ${completedCount} / ${ROLE_ORDER.length}`
          : `${completedCount} / ${ROLE_ORDER.length} 已完成`}{' '}
        · {formatCost(cost, costFormat)}
      </div>
    </div>
    {onAbort ? (
      <button className="pc-btn" data-size="sm" onClick={onAbort}>
        <IconStop size={11} /> 中断
      </button>
    ) : null}
  </div>
)

// ─── Individual role card ───────────────────────────────────────────

const STATUS_LABEL: Record<RowStatus, string> = {
  idle: '待命',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  retried: '重试中',
}

const RoleCard: FC<{
  role: RoleType
  status: RowStatus
  model?: string | undefined
  errorDetail?: string | undefined
}> = ({ role, status, model, errorDetail }) => {
  const Icon = ROLE_ICONS[role]
  const hue = hueFor(role)
  const swatch = roleSwatches(hue)

  const isRunning = status === 'running'
  const isDone = status === 'completed'
  const isFailed = status === 'failed'

  let avatarBg: string
  let avatarFg: string
  let avatarBorder: string
  let cardBorder: string
  let cardBg: string

  if (isDone) {
    avatarBg = swatch.soft
    avatarFg = swatch.base
    avatarBorder = swatch.border
    cardBorder = swatch.border
    cardBg = 'var(--surface)'
  } else if (isFailed) {
    avatarBg = 'var(--red-soft)'
    avatarFg = 'var(--red)'
    avatarBorder = 'oklch(from var(--red) l c h / 0.45)'
    cardBorder = 'oklch(from var(--red) l c h / 0.30)'
    cardBg = 'var(--red-soft)'
  } else if (isRunning) {
    avatarBg = swatch.soft
    avatarFg = swatch.base
    avatarBorder = swatch.base
    cardBorder = swatch.base
    cardBg = 'var(--surface)'
  } else {
    avatarBg = 'var(--surface-2)'
    avatarFg = 'var(--ink-3)'
    avatarBorder = 'var(--border)'
    cardBorder = 'var(--border)'
    cardBg = 'var(--surface)'
  }

  return (
    <div
      title={`${ROLE_LABEL[role]} — ${ROLE_DESCRIPTION[role]}`}
      style={{
        padding: 10,
        borderRadius: 10,
        border: `1px solid ${cardBorder}`,
        background: cardBg,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'border-color 200ms ease, background 200ms ease',
        opacity: status === 'idle' ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            position: 'relative',
            flex: '0 0 auto',
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: avatarBg,
              color: avatarFg,
              border: `1px solid ${avatarBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition:
                'background 200ms ease, color 200ms ease, border-color 200ms ease',
            }}
          >
            {isDone ? (
              <IconCheck size={13} />
            ) : isFailed ? (
              <IconX size={13} />
            ) : (
              <Icon size={13} />
            )}
          </div>
          {isRunning ? (
            <div
              style={{
                position: 'absolute',
                inset: -3,
                borderRadius: 10,
                border: `1.5px solid ${swatch.base}`,
                animation: 'pc-pulse-ring 1.4s ease-out infinite',
                pointerEvents: 'none',
              }}
            />
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: isFailed
                ? 'var(--red)'
                : isDone
                  ? 'var(--ink)'
                  : 'var(--ink-2)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {ROLE_LABEL[role]}
          </div>
          <div
            className="pc-mono"
            style={{
              fontSize: 9.5,
              color: isFailed
                ? 'var(--red)'
                : isRunning
                  ? swatch.base
                  : 'var(--ink-3)',
              marginTop: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {STATUS_LABEL[status]}
            {model && (isDone || isRunning)
              ? ` · ${model.split(/[/_-]/).slice(-2).join('-').slice(0, 16)}`
              : ''}
          </div>
        </div>
      </div>

      {isRunning ? (
        <div
          style={{
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
      {isFailed && errorDetail ? (
        <div
          style={{
            fontSize: 10,
            color: 'var(--red)',
            lineHeight: 1.35,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={errorDetail}
        >
          {errorDetail.slice(0, 60)}
        </div>
      ) : null}
    </div>
  )
}

// ─── Quick Edit standby (only Coder runs) ───────────────────────────

const QuickEditStandby: FC<{
  cost: number
  costFormat: 'friendly' | 'dollars'
  onAbort?: (() => void) | undefined
}> = ({ cost, costFormat, onAbort }) => {
  const log = useIterationStore((s) => s.toolCallLog)
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <ProducerSeat
        runningRole={'coder' as RoleType}
        completedCount={0}
        cost={cost}
        costFormat={costFormat}
        onAbort={onAbort}
      />
      <div
        className="scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--ink-3)',
            textAlign: 'center',
            padding: '12px 0',
          }}
        >
          PM 让写码工程师快速改一下。 5-15 秒。
        </div>
        {log.map((entry, i) => (
          <div
            key={`${entry.ts}-${i}`}
            className="fade-up"
            style={{
              display: 'flex',
              gap: 8,
              padding: '5px 8px',
              borderRadius: 6,
              background: entry.ok ? 'transparent' : 'var(--red-soft)',
              alignItems: 'baseline',
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: entry.ok ? 'var(--green)' : 'var(--red)',
                flex: '0 0 auto',
                marginTop: 4,
              }}
            />
            <span
              className="pc-mono"
              style={{ fontSize: 11, flex: 1, minWidth: 0 }}
            >
              {entry.tool_name} {entry.args_brief}
            </span>
            <span
              className="pc-mono"
              style={{ fontSize: 10, color: 'var(--ink-3)' }}
            >
              {(entry.duration_ms / 1000).toFixed(
                entry.duration_ms < 1000 ? 2 : 1,
              )}
              s
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Empty state ────────────────────────────────────────────────────

const RoomEmpty: FC = () => (
  <div
    style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}
  >
    <ProducerSeat
      runningRole={undefined}
      completedCount={0}
      cost={0}
      costFormat="friendly"
    />
    <div
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
        padding: 14,
        alignContent: 'start',
      }}
    >
      {ROLE_ORDER.map((role) => (
        <RoleCard key={role} role={role} status="idle" />
      ))}
    </div>
    <div
      style={{
        padding: '10px 16px 14px',
        fontSize: 11,
        color: 'var(--ink-3)',
        textAlign: 'center',
        borderTop: '1px solid var(--hairline)',
      }}
    >
      团队待命中——左边跟 PM 聊一句就能让他们开会。
    </div>
  </div>
)
