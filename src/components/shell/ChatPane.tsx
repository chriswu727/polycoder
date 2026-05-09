// Middle pane — chat surface. Bubbles + composer + auto-scroll.

import { useState } from 'react'
import type { FC, ReactNode } from 'react'

import { IconArrowUp } from '@/components/icons.js'

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

export const ChatComposer: FC<{
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
  presetLabel?: string
}> = ({ onSend, disabled = false, placeholder = "Tell your team what to build or change…", presetLabel }) => {
  const [val, setVal] = useState('')
  const send = (): void => {
    if (!val.trim()) return
    onSend(val.trim())
    setVal('')
  }
  return (
    <div
      style={{
        padding: 12,
        borderTop: '1px solid var(--hairline)',
        background: 'var(--bg-2)',
      }}
    >
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
          placeholder={placeholder}
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
            style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
          >
            {presetLabel ? `${presetLabel} preset` : ''}
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
