// 我的作品集 — past-iteration gallery.
//
// Reframes iteration history as a collectible-cards surface, not a
// terminal log. Each iteration is a chunk of "你做过的东西":
//   - prompt as title (truncated)
//   - verdict planet
//   - file count + cost + duration
//   - 第 N 轮 / quick edit badge
//   - "生成分享卡" / "在浏览器打开" actions
//
// Vibe coders open this to feel "我用 AI 做出了这些东西", not to
// debug a stuck pipeline.

import { useEffect, useState } from 'react'
import type { FC } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import { formatCost, usePreferencesStore } from '@/stores/preferences.js'
import { VerdictPlanet } from '@/components/icons.js'

type IterRow = {
  id: string
  iteration_number: number
  user_prompt: string
  status: string
  traffic_light: 'green' | 'yellow' | 'red' | null
  started_at: number
  duration_ms: number | null
  total_cost_usd: number | null
  mode: 'full' | 'quick'
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return `${d} 天前`
}

function durationLabel(ms: number | null): string {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m} 分钟`
}

const VERDICT_LABEL: Record<'green' | 'yellow' | 'red', string> = {
  green: '团队一致通过',
  yellow: '已交付，附说明',
  red: '团队建议复跑',
}

export const Gallery: FC<{
  onSelectIteration: (iterationId: string) => void
}> = ({ onSelectIteration }) => {
  const current = useWorkspaceStore((s) => s.current)
  const costFormat = usePreferencesStore((s) => s.costFormat)
  const [iters, setIters] = useState<IterRow[]>([])
  const [loading, setLoading] = useState(false)

  async function refresh(): Promise<void> {
    if (!current) return
    setLoading(true)
    try {
      const rows = await window.polycoder.iteration.list({
        workspace_id: current.id,
        limit: 100,
      })
      setIters(rows as IterRow[])
    } catch {
      setIters([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  if (!current) return null

  if (loading && iters.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          color: 'var(--ink-3)',
          fontSize: 12,
        }}
      >
        正在加载作品集…
      </div>
    )
  }

  if (iters.length === 0) {
    return <EmptyState />
  }

  return (
    <div
      className="scroll"
      style={{
        height: '100%',
        overflowY: 'auto',
        padding: '20px 22px 28px',
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <div className="pc-eyebrow">我的作品集</div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '-0.015em',
            color: 'var(--ink)',
            marginTop: 6,
          }}
        >
          团队帮你做过的 {iters.length} 件事
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {iters.map((it) => (
          <GalleryCard
            key={it.id}
            iter={it}
            costFormat={costFormat}
            onClick={() => onSelectIteration(it.id)}
          />
        ))}
      </div>
    </div>
  )
}

const GalleryCard: FC<{
  iter: IterRow
  costFormat: 'friendly' | 'dollars'
  onClick: () => void
}> = ({ iter, costFormat, onClick }) => {
  const [sharing, setSharing] = useState<'idle' | 'pending' | 'done' | 'error'>(
    'idle',
  )
  const verdict = iter.traffic_light ?? 'yellow'
  const tint =
    verdict === 'green'
      ? 'var(--green-tint)'
      : verdict === 'yellow'
        ? 'var(--amber-tint)'
        : 'var(--red-tint)'
  const border =
    verdict === 'green'
      ? 'oklch(from var(--green) l c h / 0.30)'
      : verdict === 'yellow'
        ? 'oklch(from var(--amber) l c h / 0.30)'
        : 'oklch(from var(--red) l c h / 0.30)'

  async function doShare(e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    setSharing('pending')
    try {
      const r = await window.polycoder.iteration.shareCard({
        iteration_id: iter.id,
      })
      setSharing(r.ok ? 'done' : 'error')
    } catch {
      setSharing('error')
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className="pc-card fade-up"
      style={{
        padding: 16,
        textAlign: 'left',
        cursor: 'pointer',
        background: 'var(--surface)',
        backgroundImage: `linear-gradient(135deg, ${tint}, transparent 70%)`,
        border: `1px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <VerdictPlanet verdict={verdict} size={38} />
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
            第 {iter.iteration_number} 轮
            {iter.mode === 'quick' ? ' · 快速改' : ''}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--ink-2)',
              fontWeight: 500,
            }}
          >
            {VERDICT_LABEL[verdict]}
          </div>
        </div>
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--ink)',
          lineHeight: 1.45,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {iter.user_prompt}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        <span className="pc-mono">⏱ {durationLabel(iter.duration_ms)}</span>
        <span className="pc-mono">
          ¥ {iter.total_cost_usd !== null
            ? formatCost(iter.total_cost_usd, costFormat)
            : '—'}
        </span>
        <span className="pc-mono">· {timeAgo(iter.started_at)}</span>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 6,
          paddingTop: 8,
          borderTop: '1px solid var(--hairline)',
        }}
      >
        <span
          className="pc-mono"
          style={{
            flex: 1,
            fontSize: 11,
            color: 'var(--ink-2)',
            alignSelf: 'center',
          }}
        >
          点开看 →
        </span>
        <button
          onClick={doShare}
          className="pc-btn"
          data-size="sm"
          style={{ flex: '0 0 auto' }}
          disabled={sharing === 'pending' || sharing === 'done'}
        >
          {sharing === 'idle' && '分享卡'}
          {sharing === 'pending' && '生成中'}
          {sharing === 'done' && '已生成'}
          {sharing === 'error' && '失败'}
        </button>
      </div>
    </div>
  )
}

const EmptyState: FC = () => (
  <div
    style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
      textAlign: 'center',
    }}
  >
    <div
      style={{
        fontSize: 16,
        fontWeight: 500,
        color: 'var(--ink)',
        marginBottom: 6,
      }}
    >
      还没作品。
    </div>
    <div
      style={{
        fontSize: 12.5,
        color: 'var(--ink-3)',
        lineHeight: 1.55,
        maxWidth: 320,
      }}
    >
      跟左边的项目经理说一句"做点什么"，团队就动起来。
      <br />
      做完的东西会变成可分享的卡片摆在这里。
    </div>
  </div>
)
