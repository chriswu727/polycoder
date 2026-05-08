// Top-level Workspace view — chat-like layout. Bootstraps the
// iteration store's IPC subscription on mount.

import { useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace.js'
import { useIterationStore } from '@/stores/iteration.js'
import { PromptInput } from './PromptInput.js'
import { RolePipelineProgress } from './RolePipelineProgress.js'
import { IterationResult } from './IterationResult.js'
import { IterationHistory } from './IterationHistory.js'
import { Card, CardContent } from '@/components/ui/Card.js'
import { AlertTriangle } from 'lucide-react'

export function Workspace() {
  const current = useWorkspaceStore((s) => s.current)
  const roleAssignments = useWorkspaceStore((s) => s.roleAssignments)
  const bootstrap = useIterationStore((s) => s.bootstrap)

  // Subscribe to streaming events for the lifetime of this component.
  useEffect(() => {
    const off = bootstrap(() => useWorkspaceStore.getState().current?.id ?? null)
    return off
  }, [bootstrap])

  if (!current) return null

  // Quick gate: if any role is unconfigured, point the user at Settings.
  const unconfiguredRoles = Object.values(roleAssignments ?? {}).filter(
    (a) => !a.secret_id || !a.model_id,
  )

  return (
    <div className="space-y-3">
      {unconfiguredRoles.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-start gap-2 text-sm">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-700" />
            <div>
              <strong>{unconfiguredRoles.length} role(s) unconfigured.</strong>{' '}
              Open the <strong>Settings</strong> tab and either assign a
              credential + model per row, or click a Quick Setup preset.
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PromptInput />
      <RolePipelineProgress />
      <IterationResult />
      <IterationHistory />
    </div>
  )
}
