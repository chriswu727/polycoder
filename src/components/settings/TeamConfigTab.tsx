import { AlertTriangle, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/Button.js'
import { Select } from '@/components/ui/Select.js'
import { Card, CardContent } from '@/components/ui/Card.js'
import { useWorkspaceStore } from '@/stores/workspace.js'
import { ALL_ROLES, type RoleType } from '@core/types/role.js'
import type { PresetId } from '@core/types/workspace.js'
import { checkVerificationIndependence } from '@/lib/verificationIndependence.js'

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

const PRESET_LABELS: Record<PresetId, string> = {
  budget: 'Budget',
  china_pro: 'China Pro',
  mixed: 'Mixed',
  custom: 'Custom',
}

export function TeamConfigTab() {
  const secrets = useWorkspaceStore((s) => s.secrets)
  const assignments = useWorkspaceStore((s) => s.roleAssignments)
  const setRoleAssignment = useWorkspaceStore((s) => s.setRoleAssignment)
  const applyPreset = useWorkspaceStore((s) => s.applyPreset)

  const warnings = checkVerificationIndependence(assignments)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Team configuration</h2>
          <p className="text-sm text-slate-500">
            Assign each role its own (provider, model). Different models per
            role is the whole point — see ADR-011.
          </p>
        </div>
        <PresetMenu onApply={applyPreset} />
      </div>

      {warnings.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-700" />
            <div>
              <div className="font-medium text-amber-900">
                Verification independence warning (ADR-011)
              </div>
              {warnings.map((w) => (
                <div key={w.rule} className="mt-1 text-sm text-amber-800">
                  {w.detail}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Credential</th>
                <th className="px-4 py-2 font-medium">Model</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {ALL_ROLES.map((role) => (
                <RoleRow
                  key={role}
                  role={role}
                  secrets={secrets}
                  assignment={assignments?.[role] ?? null}
                  onChange={setRoleAssignment}
                />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function PresetMenu({ onApply }: { onApply: (p: PresetId) => Promise<void> }) {
  return (
    <div className="flex items-center gap-2">
      <Wand2 size={16} className="text-slate-500" />
      <span className="text-sm text-slate-500">Quick setup:</span>
      {(['budget', 'china_pro', 'mixed'] as const).map((id) => (
        <Button
          key={id}
          variant="secondary"
          size="sm"
          onClick={() => onApply(id)}
        >
          {PRESET_LABELS[id]}
        </Button>
      ))}
    </div>
  )
}

function RoleRow({
  role,
  secrets,
  assignment,
  onChange,
}: {
  role: RoleType
  secrets: ReturnType<typeof useWorkspaceStore.getState>['secrets']
  assignment: ReturnType<typeof useWorkspaceStore.getState>['roleAssignments'] extends infer T
    ? T extends Record<RoleType, infer A>
      ? A
      : null
    : null
  onChange: (
    role: RoleType,
    secret_id: string | null,
    model_id: string | null,
  ) => Promise<void>
}) {
  const currentSecret = assignment?.secret_id
    ? secrets.find((s) => s.id === assignment.secret_id)
    : null
  const availableModels = currentSecret?.available_models ?? []

  return (
    <tr>
      <td className="px-4 py-3 font-medium">{ROLE_LABELS[role]}</td>
      <td className="px-4 py-3">
        <Select
          value={assignment?.secret_id ?? ''}
          onChange={(e) => {
            const next = e.target.value || null
            // Clear model when secret changes (model list may differ).
            void onChange(role, next, null)
          }}
        >
          <option value="">— Unassigned —</option>
          {secrets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.provider})
            </option>
          ))}
        </Select>
      </td>
      <td className="px-4 py-3">
        <Select
          value={assignment?.model_id ?? ''}
          onChange={(e) => {
            const next = e.target.value || null
            void onChange(role, assignment?.secret_id ?? null, next)
          }}
          disabled={!assignment?.secret_id}
        >
          <option value="">— Pick a credential first —</option>
          {availableModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </td>
    </tr>
  )
}
