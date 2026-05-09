// Result panel — shown in the right column above the preview after
// an iteration completes. Built around the V0.2 design pattern:
//   1. Verdict banner (orb + label + summary)
//   2. Team huddle section (DisagreementCards)
//   3. What to do next (suggestions with priority)
//   4. Files changed (collapsible)
//   5. Failure view (when iteration failed at orchestration)
//
// The "Communicator's user-facing prose" replaces the V0.1 plain-
// text block with the design's verdict-banner pattern.

import { useState } from 'react'
import type { FC } from 'react'

import { useIterationStore } from '@/stores/iteration.js'
import type { CommunicatorPayload } from '@core/types/payloads/communicator.js'

import { VerdictOrb, type Verdict } from './VerdictOrb.js'
import { DisagreementCard, type DisagreementCardData } from './DisagreementCard.js'
import {
  IconArrowRight,
  IconChevronDown,
  IconEye,
  IconFile,
  IconLock,
  IconRefresh,
  ROLE_ICONS,
} from '@/components/icons.js'
import type { RoleType } from '@core/types/role.js'

const VERDICT_LABEL: Record<Verdict, string> = {
  green: 'Looks good',
  yellow: 'Built, with notes',
  red: 'Needs your input',
}

const FRIENDLY_ROLE: Record<string, string> = {
  translator: 'Understanding your idea',
  designer: 'Sketching the layout',
  architect: 'Planning the structure',
  coder: 'Writing your app',
  adversary: 'Double-checking',
  long_term_critic: 'Reviewing',
  test_runner: 'Testing',
  communicator: 'Wrapping up',
}

type FailureCode =
  | 'envelope_parse_exhausted'
  | 'payload_validation_exhausted'
  | 'tool_loop_budget_exceeded'
  | 'provider_error'
  | 'aborted'
  | 'role_max_attempts_exceeded'

type FailureContent = {
  title: string
  body: string
  suggestions: string[]
}

const FAILURE_MESSAGES: Record<FailureCode, FailureContent> = {
  envelope_parse_exhausted: {
    title: "We couldn't make sense of one model's reply.",
    body:
      "The model returned something we couldn't parse — even after a few retries. " +
      'This is almost always a model issue, not your prompt.',
    suggestions: [
      'Try the same prompt again.',
      'Switch this role to a different model in Settings → Team.',
    ],
  },
  payload_validation_exhausted: {
    title: "A model kept producing a response that didn't match what we needed.",
    body: 'The response failed validation a few times in a row. We stopped before burning more credits.',
    suggestions: [
      'Retry — this often clears on the next run.',
      'If it keeps happening, switch the role to a stronger model.',
    ],
  },
  tool_loop_budget_exceeded: {
    title: 'One step looped longer than we allow.',
    body: "The role kept calling tools without finishing. We cut it off so the run didn't balloon.",
    suggestions: ['Retry — model will start fresh.', 'Try a smaller change in your next prompt.'],
  },
  provider_error: {
    title: 'A provider returned an error.',
    body: "The provider returned an error and didn't recover. This is on their side.",
    suggestions: ["Retry in a minute.", "Check the provider's status page if it persists."],
  },
  aborted: {
    title: 'You stopped this run.',
    body: 'No partial files were saved. Your previous iteration is unchanged.',
    suggestions: ["Send a new prompt when you're ready."],
  },
  role_max_attempts_exceeded: {
    title: "A step couldn't finish after several tries.",
    body: 'It produced no usable output after the maximum number of attempts.',
    suggestions: [
      'Try rephrasing the prompt slightly — sometimes a clearer ask helps.',
      'Or switch the role to a different model in Settings → Team.',
    ],
  },
}

const VerdictBanner: FC<{ verdict: Verdict; summary: string; meta?: string }> = ({
  verdict,
  summary,
  meta,
}) => (
  <div
    style={{
      display: 'flex',
      gap: 14,
      alignItems: 'flex-start',
      padding: '16px 18px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      boxShadow: 'var(--shadow-1)',
    }}
  >
    <VerdictOrb verdict={verdict} size={44} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {VERDICT_LABEL[verdict]}
        </div>
        {meta ? (
          <span className="pc-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
            {meta}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--ink-2)',
          marginTop: 6,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
        }}
      >
        {summary}
      </div>
    </div>
  </div>
)

const FilesChangedSection: FC<{ files: string[] }> = ({ files }) => {
  const [open, setOpen] = useState(false)
  if (files.length === 0) return null
  return (
    <div className="pc-card" style={{ padding: 0 }}>
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
        <IconFile size={14} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
          Files changed{' '}
          <span
            className="pc-mono"
            style={{ color: 'var(--ink-3)', fontWeight: 400, marginLeft: 4 }}
          >
            · {files.length}
          </span>
        </div>
        <span
          style={{
            color: 'var(--ink-3)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 180ms',
            display: 'inline-flex',
          }}
        >
          <IconChevronDown size={14} />
        </span>
      </button>
      {open ? (
        <div style={{ borderTop: '1px solid var(--hairline)' }}>
          {files.map((path) => (
            <div
              key={path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                fontSize: 12.5,
                borderBottom: '1px solid var(--hairline)',
              }}
            >
              <span className="pc-mono" style={{ color: 'var(--ink)' }}>
                {path}
              </span>
              <span style={{ flex: 1 }} />
              <button
                className="pc-btn"
                data-variant="ghost"
                data-size="sm"
                style={{ padding: '2px 6px' }}
                title="Open in default app"
              >
                <IconEye size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const SuggestionsSection: FC<{ suggestions: CommunicatorPayload['what_to_do_next'] }> = ({
  suggestions,
}) => {
  if (suggestions.length === 0) return null
  return (
    <div className="pc-card" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <IconArrowRight size={14} />
        <div style={{ fontSize: 13, fontWeight: 500 }}>What to do next</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {suggestions.map((s, i) => {
          const tone =
            s.priority === 'must' ? 'bad' : s.priority === 'recommended' ? 'warn' : 'muted'
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: 10,
                background: 'var(--surface-2)',
                borderRadius: 8,
                border: '1px solid var(--hairline)',
              }}
            >
              <span
                className="status-pill"
                data-tone={tone}
                style={{ flex: '0 0 auto', marginTop: 1 }}
              >
                {s.priority}
              </span>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, flex: 1 }}>
                {s.suggestion}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const FailureView: FC<{ code: FailureCode; stoppedAtRole: RoleType | undefined; rawError: string }>
  = ({ code, stoppedAtRole, rawError }) => {
    const f = FAILURE_MESSAGES[code]
    const [showTech, setShowTech] = useState(false)
    const Icon = stoppedAtRole ? ROLE_ICONS[stoppedAtRole] : ROLE_ICONS.coder
    const friendlyRole = stoppedAtRole
      ? (FRIENDLY_ROLE[stoppedAtRole] ?? stoppedAtRole)
      : 'a step'

    return (
      <div style={{ padding: 16 }}>
        <div
          className="pc-card"
          style={{
            padding: 22,
            borderColor: 'oklch(from var(--red) l c h / 0.3)',
          }}
        >
          <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'var(--red-soft)',
                color: 'var(--red)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 auto',
                border: '1px solid oklch(from var(--red) l c h / 0.2)',
              }}
            >
              <Icon size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="pc-mono"
                style={{
                  fontSize: 10.5,
                  color: 'var(--red)',
                  marginBottom: 3,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {friendlyRole} · stopped
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {f.title}
              </div>
            </div>
          </div>

          <div
            style={{
              fontSize: 13,
              color: 'var(--ink-2)',
              lineHeight: 1.55,
              marginBottom: 18,
            }}
          >
            {f.body}
          </div>

          <div className="pc-eyebrow" style={{ marginBottom: 8 }}>
            What you can try
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {f.suggestions.map((s, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: 10,
                  background: 'var(--surface-2)',
                  borderRadius: 8,
                  fontSize: 12.5,
                  color: 'var(--ink-2)',
                  lineHeight: 1.5,
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    fontSize: 10.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--ink-3)',
                    flex: '0 0 auto',
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1, paddingTop: 1 }}>{s}</div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowTech(!showTech)}
            className="pc-btn"
            data-variant="ghost"
            data-size="sm"
            style={{ padding: 0, color: 'var(--ink-3)' }}
          >
            {showTech ? <IconChevronDown size={12} /> : <IconChevronDown size={12} />}
            Technical details
          </button>
          {showTech ? (
            <div
              className="fade-up pc-mono"
              style={{
                marginTop: 8,
                padding: 10,
                background: 'var(--surface-sunk)',
                borderRadius: 6,
                fontSize: 11,
                color: 'var(--ink-2)',
                lineHeight: 1.5,
                border: '1px solid var(--hairline)',
                whiteSpace: 'pre-wrap',
              }}
            >
              <div>error_code: {code}</div>
              {stoppedAtRole ? <div>role: {stoppedAtRole}</div> : null}
              <div>raw: {rawError.slice(0, 500)}</div>
            </div>
          ) : null}

          <button className="pc-btn" data-variant="primary" style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}>
            <IconRefresh size={12} /> Try again
          </button>
        </div>

        <div
          style={{
            marginTop: 18,
            padding: '14px 16px',
            background: 'var(--surface-2)',
            border: '1px solid var(--hairline)',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--ink-2)',
              lineHeight: 1.5,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <IconLock size={14} style={{ color: 'var(--ink-3)', marginTop: 1 }} />
            <span>Nothing was saved. Your previous version is exactly as you left it.</span>
          </div>
        </div>
      </div>
    )
  }

export const IterationResult: FC = () => {
  const status = useIterationStore((s) => s.status)
  const result = useIterationStore((s) => s.result)
  const error = useIterationStore((s) => s.error)

  if (status === 'idle' || !result) return null

  if (status === 'failed') {
    if (result.status !== 'failed') return null
    const code = result.error_code as FailureCode
    if (!(code in FAILURE_MESSAGES)) {
      // Fallback for unrecognized codes — render in the design's
      // failure shell with the raw error in body.
      return (
        <FailureView
          code="role_max_attempts_exceeded"
          stoppedAtRole={result.stopped_at_role}
          rawError={error ?? result.error}
        />
      )
    }
    return (
      <FailureView
        code={code}
        stoppedAtRole={result.stopped_at_role}
        rawError={error ?? result.error}
      />
    )
  }

  if (status === 'aborted') {
    return (
      <FailureView
        code="aborted"
        stoppedAtRole={undefined}
        rawError={result.status === 'aborted' ? result.reason : ''}
      />
    )
  }

  if (result.status !== 'completed') return null

  const communicator = result.role_outputs.communicator?.payload as CommunicatorPayload | undefined
  if (!communicator) return null

  const verdict: Verdict = result.traffic_light
  const meta = `${(result.duration_ms / 1000).toFixed(0)}s · $${result.total_cost_usd.toFixed(2)}`

  // Cast disagreement_cards: schema validates them but TS sees them
  // as the schema's inferred shape (which matches DisagreementCardData).
  const disagreementCards = (communicator.disagreement_cards ?? []) as DisagreementCardData[]

  return (
    <div
      className="scroll"
      style={{
        overflowY: 'auto',
        height: '100%',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <VerdictBanner verdict={verdict} summary={communicator.user_facing_text} meta={meta} />

      {disagreementCards.length > 0 ? (
        <div>
          <div className="pc-eyebrow" style={{ marginBottom: 8, paddingLeft: 4 }}>
            Team huddle · {disagreementCards.length} item
            {disagreementCards.length > 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {disagreementCards.map((d, i) => (
              <DisagreementCard key={d.card_id ?? i} d={d} defaultOpen={i === 0} />
            ))}
          </div>
        </div>
      ) : null}

      <SuggestionsSection suggestions={communicator.what_to_do_next} />

      <FilesChangedSection files={result.files_changed} />
    </div>
  )
}
