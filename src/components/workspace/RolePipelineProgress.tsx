import { Loader2, CheckCircle2, XCircle, Circle, RefreshCw } from 'lucide-react'
import { useIterationStore, type RoleProgress } from '@/stores/iteration.js'
import { Card, CardContent } from '@/components/ui/Card.js'
import { Badge } from '@/components/ui/Badge.js'
import type { RoleType } from '@core/types/role.js'

const ROLE_LABELS: Record<RoleType, string> = {
  translator: 'Translator',
  designer: 'Designer',
  architect: 'Architect',
  coder: 'Coder',
  adversary: 'Adversary',
  long_term_critic: 'Long-term Critic',
  test_runner: 'Test Runner',
  communicator: 'Communicator',
}

const ROLE_ORDER: RoleType[] = [
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
]

export function RolePipelineProgress() {
  const status = useIterationStore((s) => s.status)
  const roleProgress = useIterationStore((s) => s.roleProgress)
  const cost = useIterationStore((s) => s.cumulativeCostUsd)

  if (status === 'idle') return null

  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="font-medium uppercase tracking-wide">Pipeline</span>
          <span>cost so far: ${cost.toFixed(4)}</span>
        </div>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {ROLE_ORDER.map((r) => (
            <li key={r}>
              <RoleProgressRow progress={roleProgress[r]} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function RoleProgressRow({ progress }: { progress: RoleProgress }) {
  const { icon, tone } = iconAndTone(progress.status)
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
      <span className={tone}>{icon}</span>
      <span className="flex-1 font-medium">{ROLE_LABELS[progress.role]}</span>
      {progress.model ? (
        <Badge tone="info" className="font-mono text-[10px]">
          {progress.model}
        </Badge>
      ) : null}
      {progress.envelopeStatus ? (
        <Badge tone="neutral" className="text-[10px]">
          {progress.envelopeStatus}
        </Badge>
      ) : null}
    </div>
  )
}

function iconAndTone(status: RoleProgress['status']) {
  switch (status) {
    case 'idle':
      return { icon: <Circle size={16} />, tone: 'text-slate-300' }
    case 'running':
      return {
        icon: <Loader2 size={16} className="animate-spin" />,
        tone: 'text-blue-600',
      }
    case 'completed':
      return { icon: <CheckCircle2 size={16} />, tone: 'text-emerald-600' }
    case 'failed':
      return { icon: <XCircle size={16} />, tone: 'text-red-600' }
    case 'retried':
      return { icon: <RefreshCw size={16} />, tone: 'text-amber-600' }
    case 'skipped':
      return { icon: <Circle size={16} />, tone: 'text-slate-400' }
  }
}
