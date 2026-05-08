import { useState } from 'react'
import { Send, StopCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button.js'
import { useIterationStore } from '@/stores/iteration.js'
import { useWorkspaceStore } from '@/stores/workspace.js'

export function PromptInput() {
  const ws = useWorkspaceStore((s) => s.current)
  const status = useIterationStore((s) => s.status)
  const start = useIterationStore((s) => s.start)
  const abort = useIterationStore((s) => s.abort)
  const [text, setText] = useState('')

  const running = status === 'running'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!ws) return
    const t = text.trim()
    if (!t) return
    setText('')
    await start(ws.id, t)
  }

  async function onAbort() {
    if (!ws) return
    await abort(ws.id)
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void onSubmit(e as never)
          }
        }}
        placeholder="Describe what you want to build…  (Cmd/Ctrl+Enter to submit)"
        disabled={running}
        rows={3}
        className="flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100"
      />
      {running ? (
        <Button type="button" variant="destructive" onClick={onAbort}>
          <StopCircle size={16} />
          Abort
        </Button>
      ) : (
        <Button type="submit" disabled={!text.trim() || !ws}>
          <Send size={16} />
          Send
        </Button>
      )}
    </form>
  )
}
