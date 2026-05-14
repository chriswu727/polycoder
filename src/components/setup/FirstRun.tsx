// First-run screen — the user's first 30 seconds with polycoder.
//
// Reframed for the 中年 vibe-coder market: it's not "create
// workspace, enter folder path." It's "你即将拥有一支 8 人 AI
// 团队"——hero treatment, role lineup preview, warm Chinese copy,
// then a soft folder-pick + project-name flow.
//
// Data flow unchanged: still calls workspaceStore.createWorkspace
// with (name, absolutePath) once both are filled in. The renderer
// router auto-transitions to WorkspaceShell after that.

import { useState } from 'react'
import type { FC } from 'react'

import type { RoleType } from '@core/types/role.js'
import { useWorkspaceStore } from '@/stores/workspace.js'
import {
  IconArrowRight,
  IconCheck,
  IconFolder,
  IconLock,
  ROLE_ICONS,
} from '@/components/icons.js'
import {
  ROLE_LABEL,
  hueFor,
  roleSwatches,
} from '@/components/role-palette.js'

const ROLE_LINEUP: RoleType[] = [
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
]

export const FirstRun: FC = () => {
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace)
  const [name, setName] = useState('我的第一个项目')
  const [folder, setFolder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onPickFolder(): Promise<void> {
    setError(null)
    try {
      const picker = (
        window as unknown as {
          polycoder?: {
            workspace?: {
              pickFolder?: (req?: {
                defaultPath?: string
              }) => Promise<string | null>
            }
          }
        }
      ).polycoder?.workspace?.pickFolder
      if (!picker) {
        setError(
          '文件夹选择器没启动（window.polycoder.workspace.pickFolder is undefined — are you running in a browser tab?）',
        )
        return
      }
      const picked = await picker()
      if (picked) setFolder(picked)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await createWorkspace(name, folder)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canCreate = Boolean(name.trim() && folder)

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        overflow: 'auto',
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>
        {/* Hero band */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            className="pc-bracket-eyebrow"
            style={{
              marginBottom: 14,
              justifyContent: 'center',
              display: 'flex',
              gap: 6,
            }}
          >
            <span>[</span>
            <span>8 个 AI 一起为你工作</span>
            <span>]</span>
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: '-0.025em',
              lineHeight: 1.1,
              marginBottom: 12,
              color: 'var(--ink)',
            }}
          >
            你即将拥有一支
            <br />
            <span
              style={{
                background:
                  'linear-gradient(135deg, oklch(0.65 0.18 280), oklch(0.55 0.20 250))',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              AI 团队
            </span>
            。
          </div>
          <div
            style={{
              fontSize: 14,
              color: 'var(--ink-2)',
              lineHeight: 1.6,
              maxWidth: 420,
              margin: '0 auto',
            }}
          >
            你只跟项目经理聊天，团队里其他 7 个 AI 各司其职——
            <br />
            把你的一句话变成能开盒即用的产品。
          </div>
        </div>

        {/* Role lineup chip row */}
        <RoleLineup />

        {/* Project setup card */}
        <form
          onSubmit={onSubmit}
          className="pc-card"
          style={{
            padding: 22,
            marginTop: 28,
            background: 'var(--surface)',
            backgroundImage:
              'linear-gradient(135deg, oklch(0.65 0.18 280 / 0.04), transparent 50%)',
          }}
        >
          <div
            className="pc-eyebrow"
            style={{ marginBottom: 14 }}
          >
            开新项目
          </div>

          <label style={{ display: 'block', marginBottom: 14 }}>
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--ink-2)',
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              叫什么名字？
            </div>
            <input
              className="pc-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="比如：我的第一个项目"
              required
            />
          </label>

          <label style={{ display: 'block', marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--ink-2)',
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              放在电脑哪里？
            </div>
            <button
              type="button"
              onClick={onPickFolder}
              className="pc-btn"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                background: folder ? 'var(--surface)' : 'var(--surface-2)',
              }}
            >
              <IconFolder size={14} />
              <span
                style={{
                  flex: 1,
                  textAlign: 'left',
                  color: folder ? 'var(--ink)' : 'var(--ink-3)',
                }}
                className={folder ? 'pc-mono' : ''}
              >
                {folder || '点击选一个文件夹…'}
              </span>
              {folder ? <IconCheck size={12} /> : null}
            </button>
            <div
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                marginTop: 6,
                display: 'flex',
                gap: 6,
                alignItems: 'flex-start',
              }}
            >
              <IconLock size={11} />
              你的代码只存在这台电脑上，polycoder 不会上传任何东西。
            </div>
          </label>

          {error ? (
            <div
              style={{
                marginBottom: 14,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--red-soft)',
                color: 'var(--red)',
                border: '1px solid oklch(from var(--red) l c h / 0.2)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            className="pc-btn"
            data-variant="primary"
            data-size="lg"
            style={{
              width: '100%',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 600,
            }}
            disabled={!canCreate || submitting}
          >
            {submitting ? '正在让团队就位…' : '把团队叫进来'}
            <IconArrowRight size={14} />
          </button>

          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: 'var(--ink-3)',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            进去后第一件事是给团队配点 API key（DeepSeek / GLM 几毛钱一轮）。
            <br />
            到时候项目经理会带你做。
          </div>
        </form>
      </div>
    </div>
  )
}

const RoleLineup: FC = () => (
  <div
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      justifyContent: 'center',
    }}
  >
    {ROLE_LINEUP.map((role) => (
      <RolePill key={role} role={role} />
    ))}
  </div>
)

const RolePill: FC<{ role: RoleType }> = ({ role }) => {
  const Icon = ROLE_ICONS[role]
  const hue = hueFor(role)
  const swatch = roleSwatches(hue)
  return (
    <div
      title={ROLE_LABEL[role]}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 9px 4px 6px',
        borderRadius: 100,
        background: 'var(--surface)',
        border: `1px solid ${swatch.border}`,
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--ink-2)',
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          background: swatch.soft,
          color: swatch.base,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${swatch.border}`,
        }}
      >
        <Icon size={10} />
      </span>
      <span>{ROLE_LABEL[role]}</span>
    </div>
  )
}
