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
import { formatCost, usePreferencesStore } from '@/stores/preferences.js'
import type { CommunicatorPayload } from '@core/types/payloads/communicator.js'

import { DisagreementCard, type DisagreementCardData } from './DisagreementCard.js'
import {
  IconArrowRight,
  IconChevronDown,
  IconEye,
  IconFile,
  IconLock,
  IconRefresh,
  ROLE_ICONS,
  VerdictPlanet,
  type Verdict,
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
}) => {
  // V2 design: each verdict carries a soft tonal wash so the
  // "after iteration" feeling shifts with the result. Border picks
  // up the same family.
  const borderColor =
    verdict === 'green'
      ? 'oklch(from var(--green) l c h / 0.25)'
      : verdict === 'yellow'
        ? 'oklch(from var(--amber) l c h / 0.30)'
        : 'oklch(from var(--red) l c h / 0.25)'
  const tintGradient =
    verdict === 'green'
      ? 'linear-gradient(135deg, var(--green-tint), transparent 55%)'
      : verdict === 'yellow'
        ? 'linear-gradient(135deg, var(--amber-tint), transparent 55%)'
        : 'linear-gradient(135deg, var(--red-tint), transparent 55%)'
  return (
  <div
    style={{
      display: 'flex',
      gap: 14,
      alignItems: 'flex-start',
      padding: '16px 18px',
      background: 'var(--surface)',
      backgroundImage: tintGradient,
      border: `1px solid ${borderColor}`,
      borderRadius: 12,
      boxShadow: 'var(--shadow-1)',
    }}
  >
    <VerdictPlanet verdict={verdict} size={56} />
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
}

type FileChangeEnvelope = {
  path: string
  action?: 'create' | 'edit' | 'delete' | string
  reason?: string
  content_or_diff?: string
}

/**
 * Render a unified diff as colored +/- lines. Strips the patch
 * header (the line numbers in the @@ marker are not interesting to
 * a vibe coder reviewing what changed).
 */
const DiffBlock: FC<{ diff: string }> = ({ diff }) => {
  const lines = diff.split('\n')
  // Skip the Index/===/--- /+++ patch header — the first 4 lines
  // are diff-format boilerplate.
  const renderable = lines.filter(
    (l) =>
      !l.startsWith('Index:') &&
      !l.startsWith('===') &&
      !l.startsWith('---') &&
      !l.startsWith('+++') &&
      l !== '\\ No newline at end of file',
  )
  if (renderable.every((l) => l.trim() === '')) {
    return (
      <div
        style={{
          padding: '10px 14px',
          fontSize: 12,
          color: 'var(--ink-3)',
          fontStyle: 'italic',
        }}
      >
        (no textual diff to show)
      </div>
    )
  }
  return (
    <pre
      className="pc-mono"
      style={{
        margin: 0,
        padding: '8px 0',
        fontSize: 11.5,
        lineHeight: 1.45,
        background: 'var(--bg-2)',
        overflowX: 'auto',
        maxHeight: 320,
        overflowY: 'auto',
      }}
    >
      {renderable.map((line, i) => {
        const isAdd = line.startsWith('+')
        const isDel = line.startsWith('-')
        const isHunk = line.startsWith('@@')
        const fg = isAdd
          ? 'var(--green)'
          : isDel
            ? 'var(--red)'
            : isHunk
              ? 'var(--ink-3)'
              : 'var(--ink-2)'
        const bg = isAdd
          ? 'oklch(from var(--green) l c h / 0.10)'
          : isDel
            ? 'oklch(from var(--red) l c h / 0.10)'
            : 'transparent'
        return (
          <div
            key={i}
            style={{
              padding: '0 14px',
              background: bg,
              color: fg,
              whiteSpace: 'pre',
            }}
          >
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

const FileChangeRow: FC<{ change: FileChangeEnvelope }> = ({ change }) => {
  const [open, setOpen] = useState(false)
  const hasDiff =
    !!change.content_or_diff && change.content_or_diff.trim() !== ''
  return (
    <div style={{ borderBottom: '1px solid var(--hairline)' }}>
      <button
        onClick={() => hasDiff && setOpen(!open)}
        disabled={!hasDiff}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          fontSize: 12.5,
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: hasDiff ? 'pointer' : 'default',
        }}
      >
        <span
          className="pc-mono"
          style={{
            fontSize: 9.5,
            padding: '1px 5px',
            borderRadius: 4,
            background:
              change.action === 'create'
                ? 'oklch(from var(--green) l c h / 0.15)'
                : change.action === 'delete'
                  ? 'oklch(from var(--red) l c h / 0.15)'
                  : 'var(--surface-2)',
            color:
              change.action === 'create'
                ? 'var(--green)'
                : change.action === 'delete'
                  ? 'var(--red)'
                  : 'var(--ink-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            minWidth: 36,
            textAlign: 'center',
          }}
        >
          {change.action ?? 'edit'}
        </span>
        <span className="pc-mono" style={{ color: 'var(--ink)' }}>
          {change.path}
        </span>
        <span style={{ flex: 1 }} />
        {hasDiff ? (
          <span
            style={{
              color: 'var(--ink-3)',
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 180ms',
              display: 'inline-flex',
            }}
          >
            <IconChevronDown size={12} />
          </span>
        ) : (
          <button
            className="pc-btn"
            data-variant="ghost"
            data-size="sm"
            style={{ padding: '2px 6px' }}
            title="Open in default app"
            onClick={(e) => e.stopPropagation()}
          >
            <IconEye size={11} />
          </button>
        )}
      </button>
      {open && hasDiff ? <DiffBlock diff={change.content_or_diff!} /> : null}
    </div>
  )
}

const FilesChangedSection: FC<{
  files: string[]
  changes?: FileChangeEnvelope[]
}> = ({ files, changes }) => {
  const [open, setOpen] = useState(false)
  // If we have per-file change envelopes, prefer those (richer);
  // otherwise fall back to the bare path list.
  const list: FileChangeEnvelope[] = changes && changes.length > 0
    ? changes
    : files.map((p) => ({ path: p, action: 'edit' }))
  if (list.length === 0) return null
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
            · {list.length}
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
          {list.map((c) => (
            <FileChangeRow key={c.path} change={c} />
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

const QuickEditResult: FC<{ onContinue?: (() => void) | undefined }> = ({ onContinue }) => {
  const result = useIterationStore((s) => s.result)
  const iterationId = useIterationStore((s) => s.iteration_id)
  const error = useIterationStore((s) => s.error)
  const costFormat = usePreferencesStore.getState().costFormat
  const [revertState, setRevertState] = useState<
    | { kind: 'idle' }
    | { kind: 'confirm' }
    | { kind: 'running' }
    | { kind: 'done'; restored: number; deleted: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function doRevert(): Promise<void> {
    if (!iterationId) return
    setRevertState({ kind: 'running' })
    try {
      const res = await window.polycoder.iteration.revert({
        iteration_id: iterationId,
      })
      if (!res.ok) {
        setRevertState({
          kind: 'error',
          message: res.error ?? 'revert failed',
        })
        return
      }
      setRevertState({
        kind: 'done',
        restored: res.restored.length,
        deleted: res.deleted.length,
      })
    } catch (e) {
      setRevertState({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // Failure branch — surface the error inline. Quick Edit failures
  // don't pass through the role-pipeline failure messages list; this
  // is intentionally a plainer panel.
  if (result?.status === 'failed' || result?.status === 'aborted') {
    const detail =
      result.status === 'failed' ? result.error : result.reason
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
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--surface)',
            border: '1px solid oklch(from var(--red) l c h / 0.30)',
            backgroundImage:
              'linear-gradient(135deg, var(--red-tint), transparent 55%)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-1)',
          }}
        >
          <div className="pc-eyebrow" style={{ marginBottom: 6 }}>
            Quick edit · stopped
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {detail || error || 'Quick edit did not complete.'}
          </div>
        </div>
      </div>
    )
  }

  if (result?.status !== 'completed') return null

  const coderEnvelope = result.role_outputs.coder
  const summary = coderEnvelope?.summary ?? '(no summary)'
  const meta = `${(result.duration_ms / 1000).toFixed(1)}s · ${formatCost(
    result.total_cost_usd,
    costFormat,
  )}`
  const changes =
    (coderEnvelope?.payload as { files_changed?: FileChangeEnvelope[] } | undefined)
      ?.files_changed ?? []

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
      {/* Quick edit verdict — lighter than the full pipeline planet
       *  banner. A small accent stripe + label, then the model's
       *  free-form summary. */}
      <div
        style={{
          padding: '14px 16px',
          background: 'var(--surface)',
          border: '1px solid oklch(from var(--green) l c h / 0.25)',
          backgroundImage:
            'linear-gradient(135deg, var(--green-tint), transparent 55%)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div className="pc-eyebrow">Quick edit · done</div>
          <span
            className="pc-mono"
            style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
          >
            {meta}
          </span>
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--ink-2)',
            marginTop: 8,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
          }}
        >
          {summary}
        </div>
      </div>

      <FilesChangedSection files={result.files_changed} changes={changes} />

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {onContinue && iterationId ? (
          <button
            className="pc-btn"
            data-variant="ghost"
            onClick={onContinue}
          >
            <IconArrowRight size={12} /> Continue this thread
          </button>
        ) : null}
        {iterationId && result.files_changed.length > 0 ? (
          <RevertControl
            state={revertState}
            onRequest={() => setRevertState({ kind: 'confirm' })}
            onConfirm={() => void doRevert()}
            onCancel={() => setRevertState({ kind: 'idle' })}
          />
        ) : null}
      </div>
    </div>
  )
}

const RevertControl: FC<{
  state:
    | { kind: 'idle' }
    | { kind: 'confirm' }
    | { kind: 'running' }
    | { kind: 'done'; restored: number; deleted: number }
    | { kind: 'error'; message: string }
  onRequest: () => void
  onConfirm: () => void
  onCancel: () => void
}> = ({ state, onRequest, onConfirm, onCancel }) => {
  if (state.kind === 'idle') {
    return (
      <button
        className="pc-btn"
        data-variant="ghost"
        onClick={onRequest}
        style={{ color: 'var(--red)' }}
      >
        <IconRefresh size={12} /> Revert this edit
      </button>
    )
  }
  if (state.kind === 'confirm') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          background: 'var(--red-soft)',
          border: '1px solid oklch(from var(--red) l c h / 0.30)',
          borderRadius: 8,
          fontSize: 12,
        }}
      >
        <span style={{ color: 'var(--ink-2)' }}>
          Restore files to pre-edit state?
        </span>
        <button
          className="pc-btn"
          data-size="sm"
          onClick={onConfirm}
          style={{
            background: 'var(--red)',
            color: 'white',
            borderColor: 'var(--red)',
          }}
        >
          Revert
        </button>
        <button
          className="pc-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    )
  }
  if (state.kind === 'running') {
    return (
      <span
        className="pc-mono"
        style={{ fontSize: 11, color: 'var(--ink-3)' }}
      >
        reverting…
      </span>
    )
  }
  if (state.kind === 'done') {
    const detail =
      state.restored + state.deleted === 0
        ? 'nothing to restore'
        : `${state.restored} restored${state.deleted > 0 ? `, ${state.deleted} deleted` : ''}`
    return (
      <span
        className="pc-mono"
        style={{ fontSize: 11, color: 'var(--green)' }}
      >
        ✓ {detail}
      </span>
    )
  }
  return (
    <span
      className="pc-mono"
      style={{ fontSize: 11, color: 'var(--red)' }}
    >
      revert failed: {state.message.slice(0, 80)}
    </span>
  )
}

export const IterationResult: FC<{ onContinueQuickEdit?: (() => void) | undefined }> = ({
  onContinueQuickEdit,
}) => {
  const status = useIterationStore((s) => s.status)
  const result = useIterationStore((s) => s.result)
  const error = useIterationStore((s) => s.error)
  const mode = useIterationStore((s) => s.mode)

  if (status === 'idle' || !result) return null

  // Quick Edit completed/failed: lighter result panel — no team
  // huddle, no Communicator prose (there isn't one), just Coder's
  // free-form summary + files changed + cost.
  if (mode === 'quick' && (status === 'completed' || status === 'failed')) {
    return <QuickEditResult onContinue={onContinueQuickEdit} />
  }

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
  const costFormat = usePreferencesStore.getState().costFormat
  const meta = `${(result.duration_ms / 1000).toFixed(0)}s · ${formatCost(
    result.total_cost_usd,
    costFormat,
  )}`

  // Cast disagreement_cards: schema validates them but TS sees them
  // as the schema's inferred shape (which matches DisagreementCardData).
  const disagreementCards = (communicator.disagreement_cards ?? []) as DisagreementCardData[]

  const coderChanges =
    (result.role_outputs.coder?.payload as
      | { files_changed?: FileChangeEnvelope[] }
      | undefined)?.files_changed ?? []

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

      <FilesChangedSection files={result.files_changed} changes={coderChanges} />
    </div>
  )
}
