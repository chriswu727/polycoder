// Middle pane — chat surface. Bubbles + composer + auto-scroll.

import { useState } from 'react'
import type { FC, ReactNode } from 'react'

import { IconArrowUp } from '@/components/icons.js'

export type ComposerMode = 'full' | 'quick'

export const ChatBubble: FC<{
  from: 'user' | 'team'
  meta?: string
  children: ReactNode
}> = ({ from, meta, children }) => {
  const isUser = from === 'user'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 14,
      }}
    >
      {!isUser ? (
        <div
          className="pc-mono"
          style={{
            fontSize: 10.5,
            color: 'var(--ink-3)',
            marginBottom: 4,
            paddingLeft: 2,
          }}
        >
          your team {meta ? `· ${meta}` : ''}
        </div>
      ) : null}
      <div
        style={{
          maxWidth: '88%',
          padding: '10px 13px',
          background: isUser ? 'var(--ink)' : 'var(--surface)',
          color: isUser ? 'var(--bg)' : 'var(--ink)',
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          border: isUser ? 'none' : '1px solid var(--border)',
          fontSize: 13,
          lineHeight: 1.5,
          boxShadow: isUser ? 'none' : 'var(--shadow-1)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

const MODE_LABEL: Record<ComposerMode, string> = {
  full: 'Full team',
  quick: 'Quick edit',
}

const MODE_HINT: Record<ComposerMode, string> = {
  full: 'All 8 roles weigh in. 5-15 min, ~$0.10-0.20 / iter.',
  quick: 'Coder only — fast targeted change. ~10s, ~$0.001 / iter.',
}

const MODE_PLACEHOLDER: Record<ComposerMode, string> = {
  full: 'Tell your team what to build or change…',
  quick:
    'What small change do you want? Pin files with @path, e.g. "fix off-by-one in @src/auth.ts"',
}

export const ChatComposer: FC<{
  onSend: (text: string, mode: ComposerMode) => void
  disabled?: boolean
  placeholder?: string
  presetLabel?: string
  mode: ComposerMode
  onModeChange: (mode: ComposerMode) => void
}> = ({
  onSend,
  disabled = false,
  placeholder,
  presetLabel,
  mode,
  onModeChange,
}) => {
  const [val, setVal] = useState('')
  const send = (): void => {
    if (!val.trim()) return
    onSend(val.trim(), mode)
    setVal('')
  }
  const ph = placeholder ?? MODE_PLACEHOLDER[mode]
  return (
    <div
      style={{
        padding: 12,
        borderTop: '1px solid var(--hairline)',
        background: 'var(--bg-2)',
      }}
    >
      {/* Mode segmented control. Lives above the composer card so it
       *  reads as a discrete affordance rather than a setting buried
       *  in the input's chrome. */}
      <div
        role="tablist"
        aria-label="Iteration mode"
        style={{
          display: 'inline-flex',
          gap: 0,
          padding: 3,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 9,
          marginBottom: 8,
        }}
      >
        {(['quick', 'full'] as ComposerMode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => onModeChange(m)}
            disabled={disabled}
            className="pc-mono"
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              background: mode === m ? 'var(--surface)' : 'transparent',
              color: mode === m ? 'var(--ink)' : 'var(--ink-3)',
              boxShadow: mode === m ? 'var(--shadow-1)' : 'none',
              transition: 'background 120ms ease, color 120ms ease',
            }}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-1)',
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
          placeholder={ph}
          disabled={disabled}
          rows={3}
          style={{
            border: 'none',
            background: 'transparent',
            padding: '10px 10px 4px',
            resize: 'none',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--ink)',
            outline: 'none',
            width: '100%',
            fontFamily: 'inherit',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 4px 4px',
          }}
        >
          <span
            className="pc-mono"
            style={{
              fontSize: 10.5,
              color: 'var(--ink-3)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={MODE_HINT[mode]}
          >
            {presetLabel ? `${presetLabel} preset · ` : ''}
            {MODE_HINT[mode]}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="pc-kbd">⌘</span>
            <span className="pc-kbd">↵</span>
          </span>
          <button
            className="pc-btn"
            data-variant="primary"
            data-size="sm"
            onClick={send}
            disabled={disabled || !val.trim()}
          >
            <IconArrowUp size={12} /> Send
          </button>
        </div>
      </div>
    </div>
  )
}

export const ChatPane: FC<{ children: ReactNode; footer?: ReactNode }> = ({
  children,
  footer,
}) => (
  <div className="pane pane-chat">
    <div
      className="scroll"
      style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 8px' }}
    >
      {children}
    </div>
    {footer}
  </div>
)
