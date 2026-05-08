// Renders the post-iteration state: traffic light, Communicator's
// user-facing summary, what-changed, what-to-do-next, and any
// disagreement cards.

import { useIterationStore } from '@/stores/iteration.js'
import { Card, CardContent } from '@/components/ui/Card.js'
import { Badge } from '@/components/ui/Badge.js'
import { CheckCircle2, AlertTriangle, XCircle, FilePen } from 'lucide-react'
import type { CommunicatorPayload } from '@core/types/payloads/communicator.js'

export function IterationResult() {
  const status = useIterationStore((s) => s.status)
  const result = useIterationStore((s) => s.result)
  const error = useIterationStore((s) => s.error)

  if (status === 'idle' || !result) return null

  if (status === 'failed') {
    return (
      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-red-600">
            <XCircle size={20} />
            <span className="font-semibold">Iteration failed</span>
          </div>
          <div className="text-sm text-slate-700">
            {error ?? 'unknown failure'}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === 'aborted') {
    return (
      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle size={20} />
            <span className="font-semibold">Iteration aborted</span>
          </div>
          <div className="text-sm text-slate-700">
            {result.status === 'aborted' ? result.reason : ''}
          </div>
        </CardContent>
      </Card>
    )
  }

  // Completed.
  if (result.status !== 'completed') return null

  const communicator = result.role_outputs.communicator?.payload as
    | CommunicatorPayload
    | undefined

  return (
    <div className="space-y-3">
      <TrafficLightHeader trafficLight={result.traffic_light} reason={communicator?.traffic_light_reason} />
      {communicator?.user_facing_text ? (
        <Card>
          <CardContent className="whitespace-pre-wrap text-sm leading-6">
            {communicator.user_facing_text}
          </CardContent>
        </Card>
      ) : null}

      {communicator?.disagreement_cards && communicator.disagreement_cards.length > 0 ? (
        <div className="space-y-2">
          {communicator.disagreement_cards.map((card) => (
            <DisagreementCardView key={card.card_id} card={card} />
          ))}
        </div>
      ) : null}

      {communicator?.what_changed && communicator.what_changed.length > 0 ? (
        <Card>
          <CardContent className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What changed
            </div>
            <ul className="space-y-0.5 text-sm">
              {communicator.what_changed.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <FilePen size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {communicator?.what_to_do_next && communicator.what_to_do_next.length > 0 ? (
        <Card>
          <CardContent className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What to do next
            </div>
            <ul className="space-y-1 text-sm">
              {communicator.what_to_do_next.map((next, i) => (
                <li key={i} className="flex items-start gap-2">
                  <PriorityBadge priority={next.priority} />
                  <span className="flex-1">{next.suggestion}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {result.files_changed.length > 0 ? <FileChangesList files={result.files_changed} /> : null}

      <IterationFooter
        durationMs={result.duration_ms}
        totalCostUsd={result.total_cost_usd}
        models={uniqueModels(result.role_outputs)}
      />
    </div>
  )
}

function TrafficLightHeader({
  trafficLight,
  reason,
}: {
  trafficLight: 'green' | 'yellow' | 'red'
  reason: string | undefined
}) {
  const config = {
    green: {
      tone: 'success' as const,
      icon: <CheckCircle2 size={20} />,
      label: 'Done',
      cls: 'text-emerald-700',
    },
    yellow: {
      tone: 'warning' as const,
      icon: <AlertTriangle size={20} />,
      label: 'Done with notes',
      cls: 'text-amber-700',
    },
    red: {
      tone: 'danger' as const,
      icon: <XCircle size={20} />,
      label: 'Issues',
      cls: 'text-red-700',
    },
  }[trafficLight]

  return (
    <div className="flex items-center gap-3">
      <div className={config.cls}>{config.icon}</div>
      <div className="flex-1">
        <div className="font-semibold">{config.label}</div>
        {reason ? <div className="text-xs text-slate-500">{reason}</div> : null}
      </div>
      <Badge tone={config.tone}>{trafficLight}</Badge>
    </div>
  )
}

function PriorityBadge({
  priority,
}: {
  priority: 'must' | 'recommended' | 'optional'
}) {
  const tone =
    priority === 'must' ? 'danger' : priority === 'recommended' ? 'info' : 'neutral'
  return (
    <Badge tone={tone} className="mt-0.5 text-[10px] uppercase">
      {priority}
    </Badge>
  )
}

function DisagreementCardView({
  card,
}: {
  card: NonNullable<CommunicatorPayload['disagreement_cards']>[number]
}) {
  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-700" />
          <div className="font-semibold text-amber-900">{card.topic}</div>
        </div>
        <ul className="space-y-1 text-sm text-amber-900">
          {card.stances.map((s, i) => (
            <li key={i} className="flex gap-2">
              <Badge tone="info" className="font-mono text-[10px]">
                {s.role}
              </Badge>
              <span className="text-xs text-amber-800">{s.model_label}</span>
              <span className="flex-1">{s.stance}</span>
            </li>
          ))}
        </ul>
        <div className="rounded-md bg-white/70 p-2 text-xs text-amber-900">
          <strong>Action:</strong> {card.user_action_required}
          <br />
          <strong>If you skip:</strong> {card.default_if_user_skips}
        </div>
      </CardContent>
    </Card>
  )
}

function FileChangesList({ files }: { files: string[] }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Files changed ({files.length})
        </div>
        <ul className="space-y-0.5 font-mono text-xs text-slate-700">
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function IterationFooter({
  durationMs,
  totalCostUsd,
  models,
}: {
  durationMs: number
  totalCostUsd: number
  models: string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
      <span>cost: ${totalCostUsd.toFixed(4)}</span>
      <span>duration: {(durationMs / 1000).toFixed(1)}s</span>
      <span className="flex flex-wrap gap-1">
        models:
        {models.map((m) => (
          <Badge key={m} tone="neutral" className="font-mono text-[10px]">
            {m}
          </Badge>
        ))}
      </span>
    </div>
  )
}

function uniqueModels(
  roleOutputs: Record<string, { model?: string } | undefined>,
): string[] {
  const set = new Set<string>()
  for (const v of Object.values(roleOutputs ?? {})) {
    if (v?.model) set.add(v.model)
  }
  return [...set]
}
