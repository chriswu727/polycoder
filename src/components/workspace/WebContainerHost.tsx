// WebContainer host — renders the singleton manager's state.
//
// Boot/teardown is owned by webcontainerManager (called by
// WorkspaceShell on workspace open). This component only subscribes
// for state and renders accordingly — switching tabs no longer
// destroys an in-flight WebContainer.

import { useEffect, useState } from 'react'
import type { FC } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import {
  getWebContainerState,
  subscribeWebContainer,
  type WebContainerState,
} from '@/lib/webcontainerManager.js'

export const WebContainerHost: FC = () => {
  const current = useWorkspaceStore((s) => s.current)
  const [state, setState] = useState<WebContainerState>(() =>
    getWebContainerState(),
  )

  useEffect(() => subscribeWebContainer(setState), [])

  if (!current) return null

  if (state.kind === 'running') {
    return (
      <iframe
        title="浏览器内沙盒"
        src={state.url}
        sandbox="allow-scripts allow-forms allow-same-origin"
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    )
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 360, width: '100%' }}>
        <div className="pc-eyebrow" style={{ marginBottom: 8 }}>
          浏览器内沙盒
        </div>
        {state.kind === 'idle' ? (
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            准备就绪——团队产出有 package.json 时就在这里跑起来。
          </div>
        ) : state.kind === 'booting' ? (
          <>
            <div
              style={{
                fontSize: 12,
                color: 'var(--ink-2)',
                marginBottom: 12,
              }}
            >
              {state.message}
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: 'var(--surface-2)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(state.progress01 * 100)}%`,
                  background:
                    'linear-gradient(90deg, oklch(0.65 0.18 280), oklch(0.55 0.20 250))',
                  transition: 'width 280ms ease',
                }}
              />
            </div>
          </>
        ) : state.kind === 'static-html' ? (
          <div
            style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}
          >
            这是个静态 HTML 项目，不需要沙盒——点「预览」标签直接看。
          </div>
        ) : (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              lineHeight: 1.5,
            }}
          >
            {state.reason}
          </div>
        )}
      </div>
    </div>
  )
}
