// "Team huddle" disagreement card — polycoder's signature element.
//
// Treated as a chat-thread-that-became-a-decision, not a warning
// banner. Each stance shows the role's identity (custom glyph in a
// quiet hue), its 1-line position, and a quoted-voice ribbon.
//
// Adapted from the V0.2 design package. The design used a richer
// mock shape (`title / summary / stances[{role,stance,text}] /
// decision / actions[] / skip`); the real Communicator payload
// schema lives in core/types/payloads/communicator.ts and has
// `topic / stances[{role,stance,model_label}] /
// user_action_required / default_if_user_skips`. This component
// adapts to the production shape; the design's "action buttons"
// (queue-for-next-iteration) are not yet plumbed in V0.2 — TODO.
//
// Sized variants by stance count:
//   1 voice  → "note for you"
//   2 voices → "split decision"
//   3+ voices → "team huddle"

import { useState } from 'react'
import type { FC } from 'react'

import { ROLE_ICONS, IconChevronDown } from '@/components/icons.js'
import { hueFor, shortFor } from '@/components/role-palette.js'

// Real Communicator stance shape. We accept either the schema's
// `model_label` or a missing one; some older traces don't have it.
export type Stance = {
  role: string
  stance: string
  model_label?: string
}

export type DisagreementCardData = {
  card_id: string
  between?: string[]
  topic: string
  stances: Stance[]
  user_action_required: string
  default_if_user_skips: string
}

export const RoleAvatar: FC<{ role: string; size?: number }> = ({ role, size = 28 }) => {
  const Icon = (ROLE_ICONS as Record<string, FC<{ size?: number }>>)[role] ?? ROLE_ICONS.coder
  const hue = hueFor(role)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: `oklch(0.96 0.018 ${hue})`,
        color: `oklch(0.38 0.09 ${hue})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        border: `1px solid oklch(0.88 0.025 ${hue})`,
      }}
    >
      <Icon size={Math.round(size * 0.55)} />
    </div>
  )
}

const StanceRow: FC<{ stance: Stance; isLast: boolean }> = ({ stance, isLast }) => {
  const hue = hueFor(stance.role)
  return (
    <div style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: isLast ? 0 : 16 }}>
      {!isLast && (
        <div
          style={{
            position: 'absolute',
            left: 13.5,
            top: 32,
            bottom: 0,
            width: 1,
            background: 'var(--hairline)',
          }}
        />
      )}
      <RoleAvatar role={stance.role} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: "'Geist Mono', monospace",
              fontSize: 11,
              color: `oklch(0.38 0.09 ${hue})`,
              letterSpacing: '0.02em',
              textTransform: 'lowercase',
            }}
          >
            {shortFor(stance.role)}
          </span>
          {stance.model_label ? (
            <span
              className="pc-mono"
              style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
            >
              {stance.model_label}
            </span>
          ) : null}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12.5,
            color: 'var(--ink)',
            lineHeight: 1.5,
            // textWrap: 'pretty', // not yet in TS lib types
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 2,
              height: '1em',
              verticalAlign: '-0.15em',
              marginRight: 8,
              background: `oklch(0.78 0.05 ${hue})`,
              borderRadius: 2,
            }}
          />
          {stance.stance}
        </div>
      </div>
    </div>
  )
}

export const DisagreementCard: FC<{ d: DisagreementCardData; defaultOpen?: boolean }> = ({
  d,
  defaultOpen = true,
}) => {
  const [open, setOpen] = useState(defaultOpen)

  const stanceCount = d.stances.length
  const tone = stanceCount === 1 ? 'note' : stanceCount === 2 ? 'split' : 'huddle'

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-1)',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', flex: '0 0 auto' }}>
          {d.stances.slice(0, 3).map((s, i) => (
            <div key={i} style={{ marginLeft: i === 0 ? 0 : -8 }}>
              <RoleAvatar role={s.role} size={24} />
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink)',
              letterSpacing: '-0.005em',
            }}
          >
            {d.topic}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--ink-3)',
              fontFamily: "'Geist Mono', monospace",
              marginTop: 2,
            }}
          >
            {tone === 'note' && '1 voice · note for you'}
            {tone === 'split' && '2 voices · split decision'}
            {tone === 'huddle' && `${stanceCount} voices · team huddle`}
          </div>
        </div>
        <span
          style={{
            color: 'var(--ink-3)',
            transition: 'transform 180ms',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        >
          <IconChevronDown size={14} />
        </span>
      </button>

      {open ? (
        <div className="fade-up">
          <div style={{ padding: '14px 14px 0' }}>
            {d.stances.map((s, i) => (
              <StanceRow key={i} stance={s} isLast={i === d.stances.length - 1} />
            ))}
          </div>

          <div
            style={{
              margin: '14px',
              padding: 12,
              background: 'var(--surface-2)',
              border: '1px solid var(--hairline)',
              borderRadius: 8,
            }}
          >
            <div
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 10.5,
                letterSpacing: '0.08em',
                color: 'var(--ink-3)',
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              What you can do
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 8 }}>
              {d.user_action_required}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              If you skip: {d.default_if_user_skips}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
