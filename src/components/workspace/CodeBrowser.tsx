// Code browser — file tree (left) + read-only code viewer (right).
// Lets a vibe coder see exactly what the pipeline wrote on disk.
//
// MVP: plain monospaced `<pre>` with line numbers and basic per-
// language tinting via CSS. A real CodeMirror-style editor is a
// follow-up; what matters first is that "you can click any file
// the pipeline produced and read it" works.

import { Suspense, lazy, useEffect, useState } from 'react'
import type { FC } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import { IconFile, IconRefresh } from '@/components/icons.js'

const CodeMirrorView = lazy(() => import('./CodeMirrorView.js'))

type FileEntry = { path: string; size: number; language: string }

type ReadOk = {
  ok: true
  path: string
  size: number
  content: string
  language: string
  truncated: boolean
}

type ReadResult = ReadOk | { ok: false; error: string }

function languageTint(lang: string): string {
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return 'oklch(0.85 0.10 250)'
    case 'html':
      return 'oklch(0.80 0.13 30)'
    case 'css':
      return 'oklch(0.82 0.10 200)'
    case 'json':
      return 'oklch(0.82 0.08 100)'
    case 'markdown':
      return 'oklch(0.78 0.06 60)'
    case 'python':
      return 'oklch(0.83 0.09 130)'
    default:
      return 'var(--ink-3)'
  }
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export const CodeBrowser: FC = () => {
  const current = useWorkspaceStore((s) => s.current)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<ReadResult | null>(null)
  const [loading, setLoading] = useState(false)

  async function refresh(): Promise<void> {
    if (!current) return
    setLoading(true)
    try {
      const rows = await window.polycoder.workspace.listFiles({
        workspace_id: current.id,
      })
      setFiles(rows)
      // Auto-select first file if nothing selected (or selected got removed).
      if (rows.length > 0 && (!selected || !rows.some((r) => r.path === selected))) {
        setSelected(rows[0]!.path)
      }
    } catch (e) {
      setFiles([])
      // eslint-disable-next-line no-console
      console.error('listFiles failed', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    if (!current || !selected) {
      setContent(null)
      return
    }
    let cancelled = false
    void window.polycoder.workspace
      .readFile({ workspace_id: current.id, path: selected })
      .then((r) => {
        if (!cancelled) setContent(r)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setContent({ ok: false, error: String(e) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [current?.id, selected])

  if (!current) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--ink-3)',
          fontSize: 12,
          textAlign: 'center',
        }}
      >
        选一个项目，就能查看它的文件。
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* File tree */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--hairline)',
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 10px',
            borderBottom: '1px solid var(--hairline)',
            gap: 6,
          }}
        >
          <div className="pc-eyebrow" style={{ flex: 1 }}>
            文件 · {files.length}
          </div>
          <button
            className="pc-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => void refresh()}
            title="刷新文件列表"
            aria-label="刷新文件列表"
            disabled={loading}
            style={{ padding: '2px 6px' }}
          >
            <IconRefresh size={11} />
          </button>
        </div>
        <div
          className="scroll"
          style={{ flex: 1, overflowY: 'auto', padding: '4px 4px 8px' }}
        >
          {files.length === 0 && !loading ? (
            <div
              style={{
                padding: '16px 10px',
                color: 'var(--ink-3)',
                fontSize: 11.5,
                textAlign: 'center',
                lineHeight: 1.4,
              }}
            >
              工作区暂无文件。先告诉项目经理你想做什么——写码工程师写完，这里就会出现。
            </div>
          ) : null}
          {files.map((f) => {
            const isActive = selected === f.path
            return (
              <button
                key={f.path}
                onClick={() => setSelected(f.path)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: isActive ? 'var(--surface-2)' : 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--ink)',
                  fontSize: 11.5,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                }}
                title={`${f.path} · ${humanSize(f.size)}`}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: languageTint(f.language),
                    flex: '0 0 auto',
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f.path}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Code viewer */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--hairline)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <IconFile size={12} />
          <span
            className="pc-mono"
            style={{
              fontSize: 11.5,
              color: 'var(--ink)',
              minWidth: 0,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selected ?? '（未选中文件）'}
          </span>
          {content?.ok ? (
            <span
              className="pc-mono"
              style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
            >
              {humanSize(content.size)} · {content.language}
              {content.truncated ? ' · 已截断' : ''}
            </span>
          ) : null}
        </div>
        <div
          className="scroll"
          style={{ flex: 1, overflow: 'auto', background: 'var(--bg-2)' }}
        >
          {!selected ? (
            <div
              style={{
                padding: 32,
                color: 'var(--ink-3)',
                fontSize: 12,
                textAlign: 'center',
              }}
            >
              在左侧选一个文件。
            </div>
          ) : content === null ? (
            <div
              style={{
                padding: 16,
                color: 'var(--ink-3)',
                fontSize: 11.5,
                fontStyle: 'italic',
              }}
            >
              加载中…
            </div>
          ) : content.ok ? (
            <Suspense
              fallback={
                <div
                  style={{
                    padding: 16,
                    color: 'var(--ink-3)',
                    fontSize: 11.5,
                    fontStyle: 'italic',
                  }}
                >
                  加载中…
                </div>
              }
            >
              <CodeMirrorView content={content.content} language={content.language} />
            </Suspense>
          ) : (
            <div
              style={{
                padding: 16,
                color: 'var(--red)',
                fontSize: 12,
              }}
            >
              读取文件失败：{content.error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

