// Producer chat surface — replaces the old one-shot ChatComposer
// pattern. User talks naturally to the Producer (项目经理); the
// Producer decides when to ask clarification vs dispatch the team.

import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'

import { useProducerStore } from '@/stores/producer.js'
import { useWorkspaceStore } from '@/stores/workspace.js'
import { IconArrowUp, IconSparkle } from '@/components/icons.js'

const PRODUCER_GREETING =
  '你好。我是这个项目的项目经理（PM），帮你协调一支 8 人的 AI 团队。\n\n告诉我你想做什么——可以模糊（"做个能记账的"），也可以具体（"改一下这里的颜色"）。我先问几个澄清的事，然后让团队上手。'

export const ProducerChat: FC = () => {
  const current = useWorkspaceStore((s) => s.current)
  const messages = useProducerStore((s) => s.messages)
  const liveTools = useProducerStore((s) => s.liveToolInvocations)
  const sending = useProducerStore((s) => s.sending)
  const error = useProducerStore((s) => s.error)
  const totalCost = useProducerStore((s) => s.totalCostUsd)
  const loadHistory = useProducerStore((s) => s.loadHistory)
  const sendMessage = useProducerStore((s) => s.sendMessage)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (current) void loadHistory(current.id)
  }, [current?.id, loadHistory, current])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, sending])

  if (!current) return null

  async function send(): Promise<void> {
    const trimmed = input.trim()
    if (!trimmed || sending || !current) return
    setInput('')
    await sendMessage(current.id, trimmed)
  }

  const showGreeting = messages.length === 0

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--hairline)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconSparkle size={13} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>项目经理 (PM)</div>
          <div
            className="pc-mono"
            style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1 }}
          >
            你的 AI 团队入口 · 总开销 $
            {totalCost.toFixed(4)}
          </div>
        </div>
      </div>

      {/* Conversation scroll */}
      <div
        ref={scrollRef}
        className="scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {showGreeting ? (
          <ChatBubble role="assistant">{PRODUCER_GREETING}</ChatBubble>
        ) : null}
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role}>
            {m.content}
          </ChatBubble>
        ))}
        {sending ? (
          <div
            className="pc-mono"
            style={{
              fontSize: 11,
              color: 'var(--ink-3)',
              fontStyle: 'italic',
              padding: '4px 10px',
            }}
          >
            项目经理正在思考…
          </div>
        ) : null}
        {liveTools.length > 0 && !sending ? (
          <div
            className="pc-card"
            style={{
              padding: '8px 12px',
              fontSize: 11,
              color: 'var(--ink-3)',
              alignSelf: 'flex-start',
              maxWidth: '88%',
            }}
          >
            <div className="pc-eyebrow" style={{ marginBottom: 4 }}>
              这一轮 PM 调度
            </div>
            {liveTools.map((t, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'baseline',
                  padding: '2px 0',
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: t.ok ? 'var(--green)' : 'var(--red)',
                    display: 'inline-block',
                    flex: '0 0 auto',
                  }}
                />
                <span className="pc-mono" style={{ fontSize: 10.5 }}>
                  {toolLabel(t.name)}
                  {t.brief ? `: ${t.brief.slice(0, 60)}` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <div
            style={{
              padding: 10,
              fontSize: 12,
              color: 'var(--red)',
              border: '1px solid oklch(from var(--red) l c h / 0.30)',
              background: 'var(--red-soft)',
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>

      {/* Composer */}
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
            }}
            placeholder="跟项目经理说你想做什么…（⌘↵ 发送）"
            disabled={sending}
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
              style={{ fontSize: 10.5, color: 'var(--ink-3)', flex: 1 }}
            >
              {sending ? '团队正在工作…' : 'PM 会先问几个澄清问题再调度团队'}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="pc-kbd">⌘</span>
              <span className="pc-kbd">↵</span>
            </span>
            <button
              className="pc-btn"
              data-variant="primary"
              data-size="sm"
              onClick={() => void send()}
              disabled={sending || !input.trim()}
            >
              <IconArrowUp size={12} /> 发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function toolLabel(name: string): string {
  switch (name) {
    case 'run_full_pipeline':
      return '全团队上阵'
    case 'run_quick_edit':
      return '写码工程师快速改'
    case 'list_workspace_files':
      return '查看文件清单'
    case 'read_workspace_file':
      return '读了一份文件'
    default:
      return name
  }
}

const ChatBubble: FC<{
  role: 'user' | 'assistant'
  children: React.ReactNode
}> = ({ role, children }) => {
  const isUser = role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        gap: 4,
      }}
    >
      {!isUser ? (
        <div
          className="pc-mono"
          style={{
            fontSize: 10.5,
            color: 'var(--ink-3)',
            paddingLeft: 2,
          }}
        >
          项目经理
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
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          boxShadow: isUser ? 'none' : 'var(--shadow-1)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
