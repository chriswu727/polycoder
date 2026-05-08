// Past iterations list — collapsible. Shows count of iterations,
// traffic light dot, prompt summary. Click loads that iteration's
// communicator output (V1+).

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card.js'
import { useWorkspaceStore } from '@/stores/workspace.js'
import { ChevronDown, ChevronRight } from 'lucide-react'

type Iteration = {
  id: string
  iteration_number: number
  user_prompt: string
  status: string
  traffic_light: string | null
  started_at: number
}

export function IterationHistory() {
  const ws = useWorkspaceStore((s) => s.current)
  const [items, setItems] = useState<Iteration[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!ws) {
      setItems(null)
      return
    }
    let cancelled = false
    void window.polycoder.iteration
      .list({ workspace_id: ws.id, limit: 20 })
      .then((list) => {
        if (cancelled) return
        setItems(list as Iteration[])
      })
    return () => {
      cancelled = true
    }
  }, [ws])

  if (!ws || !items || items.length === 0) return null

  return (
    <Card>
      <CardContent className="space-y-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
        >
          <span className="flex items-center gap-1">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Past iterations ({items.length})
          </span>
        </button>
        {open ? (
          <ul className="space-y-1">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50"
              >
                <TrafficDot tl={it.traffic_light} />
                <span className="font-mono text-xs text-slate-500">
                  #{it.iteration_number}
                </span>
                <span className="flex-1 truncate text-slate-700">
                  {it.user_prompt.slice(0, 100)}
                </span>
                <span className="text-xs text-slate-400">
                  {new Date(it.started_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}

function TrafficDot({ tl }: { tl: string | null }) {
  const cls =
    tl === 'green'
      ? 'bg-emerald-500'
      : tl === 'yellow'
        ? 'bg-amber-500'
        : tl === 'red'
          ? 'bg-red-500'
          : 'bg-slate-300'
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
}
