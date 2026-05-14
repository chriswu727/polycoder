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

type SetupStep = 'idle' | 'creating' | 'saving-key' | 'testing-key' | 'applying-preset'

const STEP_LABEL: Record<Exclude<SetupStep, 'idle'>, string> = {
  'creating': '建项目工作区…',
  'saving-key': '把 API key 存进系统钥匙串…',
  'testing-key': '验证 key 能不能调通…',
  'applying-preset': '给 8 个角色分配模型…',
}

export const FirstRun: FC = () => {
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace)
  const addSecret = useWorkspaceStore((s) => s.addSecret)
  const testSecret = useWorkspaceStore((s) => s.testSecret)
  const refreshSecrets = useWorkspaceStore((s) => s.refreshSecrets)
  const applyPreset = useWorkspaceStore((s) => s.applyPreset)
  const [name, setName] = useState('我的第一个项目')
  const [folder, setFolder] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<SetupStep>('idle')

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

    setStep('creating')
    try {
      await createWorkspace(name, folder)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('idle')
      return
    }

    // If the user didn't paste a key, leave the team unconfigured —
    // they can do it manually from Settings. The router will land
    // them in the workspace and ProducerChat surfaces a clear error
    // on first send if Translator/Coder aren't assigned.
    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      setStep('idle')
      return
    }

    setStep('saving-key')
    const addResult = await addSecret({
      name: 'DeepSeek',
      provider: 'deepseek',
      api_key: trimmedKey,
    })
    if (!addResult.ok) {
      setError(`保存 key 失败：${addResult.error ?? '未知错误'}。可以稍后在「设置 → 密钥」里再加。`)
      setStep('idle')
      return
    }

    setStep('testing-key')
    await refreshSecrets()
    // The secret we just added is the only one with provider=deepseek
    // and no last_tested_at yet — grab it back.
    const list = useWorkspaceStore.getState().secrets
    const justAdded = list.find((s) => s.provider === 'deepseek')
    if (justAdded) {
      try {
        const test = await testSecret(justAdded.id)
        if (!test.ok) {
          setError(
            `key 没调通：${test.detail}。项目已经建好——你可以稍后在「设置」里重新加 key。`,
          )
          setStep('idle')
          return
        }
      } catch (e) {
        // testSecret only throws on no-workspace; we just created one.
        setError(e instanceof Error ? e.message : String(e))
        setStep('idle')
        return
      }
    }

    setStep('applying-preset')
    try {
      await applyPreset('budget')
    } catch (e) {
      setError(
        `分配角色时出错：${e instanceof Error ? e.message : String(e)}。项目已经建好，去「设置 → 团队」点一下「Budget」就能继续。`,
      )
      setStep('idle')
      return
    }

    setStep('idle')
    // The router auto-transitions to WorkspaceShell once `current` is set.
  }

  const submitting = step !== 'idle'
  const canCreate = Boolean(name.trim() && folder) && !submitting

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

          <label style={{ display: 'block', marginBottom: 14 }}>
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

          <label style={{ display: 'block', marginBottom: 18 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--ink-2)',
                  fontWeight: 500,
                  flex: 1,
                }}
              >
                DeepSeek API key
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 10.5,
                    color: 'var(--ink-3)',
                    fontWeight: 400,
                  }}
                >
                  可跳过 · 之后在「设置」里加也行
                </span>
              </div>
            </div>
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <input
                className="pc-input pc-mono"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                style={{ paddingRight: 56 }}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="pc-mono"
                style={{
                  position: 'absolute',
                  right: 6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  fontSize: 10.5,
                  color: 'var(--ink-3)',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: 4,
                }}
                tabIndex={-1}
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                marginTop: 6,
                lineHeight: 1.5,
              }}
            >
              填了就一键搞定，团队立刻就能干活。DeepSeek 一条命令几分钱，
              <a
                href="https://platform.deepseek.com/api_keys"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--ink-2)' }}
              >
                去官网拿 key
              </a>
              。
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
            disabled={!canCreate}
          >
            {submitting ? STEP_LABEL[step as Exclude<SetupStep, 'idle'>] : '把团队叫进来'}
            {!submitting ? <IconArrowRight size={14} /> : null}
          </button>

          {submitting ? <SetupProgressBar step={step} /> : null}

          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: 'var(--ink-3)',
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            {apiKey.trim()
              ? '配好就直接进项目，跟项目经理说一句就开干。'
              : '没填 key 也能进项目——之后在「设置 → 密钥」里加，再选 Budget preset 即可。'}
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

const SETUP_STEPS: Exclude<SetupStep, 'idle'>[] = [
  'creating',
  'saving-key',
  'testing-key',
  'applying-preset',
]

const SetupProgressBar: FC<{ step: SetupStep }> = ({ step }) => {
  if (step === 'idle') return null
  const currentIdx = SETUP_STEPS.indexOf(step)
  return (
    <div
      style={{
        marginTop: 12,
        display: 'flex',
        gap: 4,
        padding: '0 2px',
      }}
    >
      {SETUP_STEPS.map((s, i) => (
        <div
          key={s}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 2,
            background:
              i < currentIdx
                ? 'oklch(0.55 0.20 250)'
                : i === currentIdx
                  ? 'oklch(0.65 0.18 280)'
                  : 'var(--surface-2)',
            transition: 'background 200ms ease',
            animation:
              i === currentIdx
                ? 'pc-progress-indeterminate 1.4s ease-in-out infinite'
                : undefined,
          }}
        />
      ))}
    </div>
  )
}

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
