// V3 cosmic restyle. The Settings → Team panel is the one place
// it's OK to feel slightly more technical (power-user surface);
// the design still goes through the same .pc-card / .pc-btn /
// .pc-input primitives so it doesn't read as a different app.

import { useState } from 'react'
import type { FC } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import { ALL_ROLES, type RoleType } from '@core/types/role.js'
import type { PresetId, SecretMeta } from '@core/types/workspace.js'
import { checkVerificationIndependence } from '@/lib/verificationIndependence.js'
import {
  IconCheck,
  IconChevronDown,
  IconCpu,
  IconWarn,
  ROLE_ICONS,
} from '@/components/icons.js'
import { ROLE_LABEL } from '@/components/role-palette.js'

const PRESETS: { id: PresetId; label: string; blurb: string; cost: string }[] = [
  {
    id: 'budget',
    label: 'Budget',
    blurb: 'Cheapest mix that still works. Good for tinkering.',
    cost: '~$0.04 / iter',
  },
  {
    id: 'china_pro',
    label: 'China-Pro',
    blurb: 'Top Chinese providers. Fast and capable, China-region friendly.',
    cost: '~$0.12 / iter',
  },
  {
    id: 'mixed',
    label: 'Mixed',
    blurb: "Best-in-class per role regardless of provider.",
    cost: '~$0.22 / iter',
  },
]

export function TeamConfigTab(): React.ReactElement {
  const secrets = useWorkspaceStore((s) => s.secrets)
  const assignments = useWorkspaceStore((s) => s.roleAssignments)
  const setRoleAssignment = useWorkspaceStore((s) => s.setRoleAssignment)
  const applyPreset = useWorkspaceStore((s) => s.applyPreset)
  const [advanced, setAdvanced] = useState(false)

  const warnings = checkVerificationIndependence(assignments)

  // Heuristic "current preset" detection: if all 8 assignments are
  // unset → "unassigned". Otherwise we mark "Custom" — V0.2 doesn't
  // track which preset was last applied. Future work.
  const allUnset =
    !assignments ||
    ALL_ROLES.every(
      (r) => !assignments[r]?.secret_id || !assignments[r]?.model_id,
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {warnings.length > 0 ? (
        <div
          className="pc-card"
          style={{
            padding: 12,
            borderColor: 'oklch(from var(--amber) l c h / 0.4)',
            background: 'var(--amber-soft)',
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <IconWarn
              size={14}
              style={{ color: 'var(--amber)', marginTop: 2, flex: '0 0 auto' }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>
                Verification-independence note (ADR-011)
              </div>
              {warnings.map((w) => (
                <div
                  key={w.rule}
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-2)',
                    marginTop: 2,
                    lineHeight: 1.45,
                  }}
                >
                  {w.detail}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Preset row */}
      <div>
        <div className="pc-eyebrow" style={{ marginBottom: 10 }}>
          One-click presets
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => void applyPreset(p.id)}
              className="pc-card"
              style={{
                padding: 12,
                textAlign: 'left',
                cursor: 'pointer',
                background: 'var(--surface)',
                font: 'inherit',
                color: 'inherit',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
                {p.label}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--ink-2)',
                  lineHeight: 1.4,
                  marginBottom: 8,
                }}
              >
                {p.blurb}
              </div>
              <div
                className="pc-mono"
                style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
              >
                {p.cost}
              </div>
            </button>
          ))}
        </div>
        {allUnset ? (
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--ink-3)',
              marginTop: 8,
              lineHeight: 1.4,
            }}
          >
            No roles assigned yet — pick a preset above for a one-click setup.
          </div>
        ) : null}
      </div>

      {/* Advanced */}
      <div className="pc-card" style={{ padding: 0, overflow: 'hidden' }}>
        <button
          onClick={() => setAdvanced(!advanced)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '12px 14px',
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
            cursor: 'pointer',
            color: 'inherit',
            font: 'inherit',
          }}
        >
          <IconCpu size={14} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              Advanced — assign per role
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              {advanced
                ? 'Override individual roles'
                : "For when a preset isn't quite right"}
            </div>
          </div>
          <span
            style={{
              color: 'var(--ink-3)',
              transform: advanced ? 'rotate(0)' : 'rotate(-90deg)',
              transition: 'transform 180ms',
              display: 'inline-flex',
            }}
          >
            <IconChevronDown size={14} />
          </span>
        </button>

        {advanced ? (
          <div style={{ borderTop: '1px solid var(--hairline)' }}>
            {ALL_ROLES.map((role, i) => (
              <RoleRow
                key={role}
                role={role}
                isLast={i === ALL_ROLES.length - 1}
                secrets={secrets}
                assignment={assignments?.[role] ?? null}
                onChange={setRoleAssignment}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

type Assignment = {
  secret_id: string | null
  model_id: string | null
}

const RoleRow: FC<{
  role: RoleType
  isLast: boolean
  secrets: SecretMeta[]
  assignment: Assignment | null
  onChange: (
    role: RoleType,
    secret_id: string | null,
    model_id: string | null,
  ) => Promise<void>
}> = ({ role, isLast, secrets, assignment, onChange }) => {
  const currentSecret = assignment?.secret_id
    ? secrets.find((s) => s.id === assignment.secret_id)
    : null
  const availableModels = currentSecret?.available_models ?? []
  const Icon = ROLE_ICONS[role]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderBottom: isLast ? 'none' : '1px solid var(--hairline)',
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--ink-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto',
        }}
      >
        <Icon size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{ROLE_LABEL[role]}</div>
        <div
          className="pc-mono"
          style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
        >
          {role}
        </div>
      </div>
      <select
        className="pc-input"
        style={{ minWidth: 180, flex: '0 0 auto', width: 200 }}
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
      </select>
      <select
        className="pc-input"
        style={{ minWidth: 180, flex: '0 0 auto', width: 200 }}
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
      </select>
      {assignment?.secret_id && assignment.model_id ? (
        <IconCheck size={14} style={{ color: 'var(--green)' }} />
      ) : null}
    </div>
  )
}
