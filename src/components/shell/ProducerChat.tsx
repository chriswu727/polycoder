// Producer chat surface — replaces the old one-shot ChatComposer
// pattern. User talks naturally to the Producer (项目经理); the
// Producer decides when to ask clarification vs dispatch the team.

import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'

import { useProducerStore } from '@/stores/producer.js'
import { useWorkspaceStore } from '@/stores/workspace.js'
import { formatCost, usePreferencesStore } from '@/stores/preferences.js'
import { IconArrowUp, VerdictPlanet } from '@/components/icons.js'

type DeliverySummary = {
  traffic_light: 'green' | 'yellow' | 'red' | null
  iteration_number: number
  files_changed: string[]
  total_cost_usd: number | null
  duration_ms: number | null
  user_prompt: string
}

const deliveryCardCache = new Map<string, DeliverySummary>()

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
  const costFormat = usePreferencesStore((s) => s.costFormat)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const currentId = current?.id
  useEffect(() => {
    if (currentId) void loadHistory(currentId)
  }, [currentId, loadHistory])

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
      {/* Header — Producer as the central character */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--hairline)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background:
            'linear-gradient(135deg, oklch(0.65 0.18 280 / 0.06), transparent 60%)',
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
              width: 38,
              height: 38,
              borderRadius: 11,
              background:
                'linear-gradient(135deg, oklch(0.65 0.18 280), oklch(0.55 0.20 250))',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px oklch(0.55 0.20 250 / 0.35)',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            PM
          </div>
          {sending ? (
            <div
              style={{
                position: 'absolute',
                inset: -3,
                borderRadius: 13,
                border: '1.5px solid oklch(0.65 0.18 280)',
                animation: 'pc-pulse-ring 1.6s ease-out infinite',
                pointerEvents: 'none',
              }}
            />
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>
            项目经理
          </div>
          <div
            className="pc-mono"
            style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2 }}
          >
            8 人 AI 团队 · 你只跟我聊
          </div>
        </div>
        <div
          title="PM 自己跟你聊天的 token 消耗。团队真去干活的成本另算（每个 iter 卡片上会显示）。"
          style={{
            textAlign: 'right',
            flex: '0 0 auto',
          }}
        >
          <div
            className="pc-mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            PM 调度成本
          </div>
          <div
            className="pc-mono"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink)',
              fontVariantNumeric: 'tabular-nums',
              marginTop: 1,
            }}
          >
            {formatCost(totalCost, costFormat)}
          </div>
          <div
            className="pc-mono"
            style={{
              fontSize: 9.5,
              color: 'var(--ink-3)',
              marginTop: 1,
            }}
          >
            （团队工作另算）
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
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              gap: 8,
            }}
          >
            <ChatBubble role={m.role}>{m.content}</ChatBubble>
            {m.role === 'assistant' && m.iteration_id ? (
              <DeliveryCard iterationId={m.iteration_id} />
            ) : null}
          </div>
        ))}
        {sending ? (
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '6px 12px',
              alignSelf: 'flex-start',
              background: 'oklch(0.65 0.18 280 / 0.08)',
              border: '1px solid oklch(0.65 0.18 280 / 0.20)',
              borderRadius: 14,
            }}
          >
            <span style={{ display: 'inline-flex', gap: 3 }}>
              <Dot delay={0} />
              <Dot delay={0.2} />
              <Dot delay={0.4} />
            </span>
            <span
              className="pc-mono"
              style={{ fontSize: 11, color: 'oklch(0.55 0.20 250)' }}
            >
              项目经理正在思考
            </span>
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

// Inline "我的 AI 团队交付了这个" mini-card. Pulled from
// window.polycoder.iteration.get on mount; cached per iteration_id
// so revisiting old conversations doesn't re-fetch.
const DeliveryCard: FC<{ iterationId: string }> = ({ iterationId }) => {
  const [summary, setSummary] = useState<DeliverySummary | null>(
    () => deliveryCardCache.get(iterationId) ?? null,
  )
  const [sharing, setSharing] = useState<'idle' | 'pending' | 'done' | 'error'>(
    'idle',
  )
  const costFormat = usePreferencesStore((s) => s.costFormat)

  useEffect(() => {
    const cached = deliveryCardCache.get(iterationId)
    if (cached) {
      setSummary(cached)
      return
    }
    let cancelled = false
    void window.polycoder.iteration
      .get({ iteration_id: iterationId })
      .then((r) => {
        if (cancelled) return
        if (!r.ok || !r.record) return
        const next: DeliverySummary = {
          traffic_light: r.record.traffic_light,
          iteration_number: r.record.iteration_number,
          files_changed: r.record.files_changed,
          total_cost_usd: r.record.total_cost_usd,
          duration_ms: r.record.duration_ms,
          user_prompt: r.record.user_prompt,
        }
        deliveryCardCache.set(iterationId, next)
        setSummary(next)
      })
      .catch(() => {
        /* card just doesn't render */
      })
    return () => {
      cancelled = true
    }
  }, [iterationId])

  if (!summary) return null

  const verdict = summary.traffic_light ?? 'yellow'
  const verdictLabel =
    verdict === 'green'
      ? '团队一致通过'
      : verdict === 'yellow'
        ? '已交付，附说明'
        : '团队建议复跑'
  const verdictTint =
    verdict === 'green'
      ? 'var(--green-tint)'
      : verdict === 'yellow'
        ? 'var(--amber-tint)'
        : 'var(--red-tint)'
  const verdictBorder =
    verdict === 'green'
      ? 'oklch(from var(--green) l c h / 0.30)'
      : verdict === 'yellow'
        ? 'oklch(from var(--amber) l c h / 0.30)'
        : 'oklch(from var(--red) l c h / 0.30)'
  const cost =
    summary.total_cost_usd !== null
      ? formatCost(summary.total_cost_usd, costFormat)
      : '—'
  const duration =
    summary.duration_ms !== null
      ? `${Math.round(summary.duration_ms / 1000)}s`
      : '—'

  async function doShare(): Promise<void> {
    setSharing('pending')
    try {
      const r = await window.polycoder.iteration.shareCard({
        iteration_id: iterationId,
      })
      setSharing(r.ok ? 'done' : 'error')
    } catch {
      setSharing('error')
    }
  }

  return (
    <div
      className="fade-up"
      style={{
        maxWidth: '88%',
        padding: '12px 14px',
        background: 'var(--surface)',
        backgroundImage: `linear-gradient(135deg, ${verdictTint}, transparent 65%)`,
        border: `1px solid ${verdictBorder}`,
        borderRadius: '14px 14px 14px 4px',
        boxShadow: 'var(--shadow-1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <VerdictPlanet verdict={verdict} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="pc-mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 2,
            }}
          >
            第 {summary.iteration_number} 轮 · {verdictLabel}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--ink)',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {summary.user_prompt}
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        <span className="pc-mono">耗时 {duration}</span>
        <span className="pc-mono">花费 {cost}</span>
        <span className="pc-mono">{summary.files_changed.length} 个文件</span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="pc-btn"
          data-size="sm"
          onClick={() => void doShare()}
          disabled={sharing === 'pending' || sharing === 'done'}
        >
          {sharing === 'idle' && '生成分享卡'}
          {sharing === 'pending' && '生成中…'}
          {sharing === 'done' && '已生成'}
          {sharing === 'error' && '生成失败'}
        </button>
      </div>
    </div>
  )
}

const Dot: FC<{ delay: number }> = ({ delay }) => (
  <span
    style={{
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'oklch(0.55 0.20 250)',
      display: 'inline-block',
      animation: 'pc-bounce-dot 1.2s ease-in-out infinite',
      animationDelay: `${delay}s`,
    }}
  />
)

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
