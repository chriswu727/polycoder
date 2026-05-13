// Preferences panel — UI for the values in usePreferencesStore.
// Covers theme + cost format. Adds here, not under workspace
// secrets / team config, because these are app-wide and not tied
// to any one workspace.

import type { FC } from 'react'

import {
  formatCost,
  usePreferencesStore,
  type CostFormat,
  type ThemePref,
} from '@/stores/preferences.js'
import { IconCheck, IconMoon, IconSun } from '@/components/icons.js'

export const PreferencesTab: FC = () => {
  const theme = usePreferencesStore((s) => s.theme)
  const setTheme = usePreferencesStore((s) => s.setTheme)
  const costFormat = usePreferencesStore((s) => s.costFormat)
  const setCostFormat = usePreferencesStore((s) => s.setCostFormat)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Theme */}
      <div>
        <div className="pc-eyebrow" style={{ marginBottom: 10 }}>
          Theme
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <ThemeCard
            kind="dark"
            active={theme === 'dark'}
            onSelect={() => setTheme('dark')}
          />
          <ThemeCard
            kind="light"
            active={theme === 'light'}
            onSelect={() => setTheme('light')}
          />
        </div>
      </div>

      {/* Cost format */}
      <div>
        <div className="pc-eyebrow" style={{ marginBottom: 10 }}>
          How costs are shown
        </div>
        <div className="pc-card" style={{ padding: 0, overflow: 'hidden' }}>
          <CostRow
            id="friendly"
            label="Friendly"
            preview={formatCost(0.06, 'friendly') + ' / iter'}
            active={costFormat === 'friendly'}
            onSelect={() => setCostFormat('friendly')}
          />
          <div style={{ height: 1, background: 'var(--hairline)' }} />
          <CostRow
            id="dollars"
            label="Dollars"
            preview={formatCost(0.06, 'dollars') + ' / iter'}
            active={costFormat === 'dollars'}
            onSelect={() => setCostFormat('dollars')}
          />
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--ink-3)',
            marginTop: 8,
            lineHeight: 1.4,
          }}
        >
          Affects how polycoder shows running totals + iteration
          summaries.
        </div>
      </div>
    </div>
  )
}

const ThemeCard: FC<{ kind: ThemePref; active: boolean; onSelect: () => void }> = ({
  kind,
  active,
  onSelect,
}) => (
  <button
    onClick={onSelect}
    className="pc-card"
    style={{
      padding: 14,
      textAlign: 'left',
      cursor: 'pointer',
      background: 'var(--surface)',
      borderColor: active ? 'var(--accent)' : 'var(--border)',
      font: 'inherit',
      color: 'inherit',
      position: 'relative',
    }}
  >
    {active ? (
      <span
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--accent)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconCheck size={10} />
      </span>
    ) : null}
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        marginBottom: 6,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: kind === 'dark' ? 'oklch(0.18 0.04 265)' : 'oklch(0.96 0.01 60)',
          color: kind === 'dark' ? 'oklch(0.85 0.05 220)' : 'oklch(0.62 0.12 50)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--border)',
        }}
      >
        {kind === 'dark' ? <IconMoon size={14} /> : <IconSun size={14} />}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>
        {kind === 'dark' ? 'Cosmic dark' : 'Polished light'}
      </div>
    </div>
    <div
      style={{
        fontSize: 11.5,
        color: 'var(--ink-2)',
        lineHeight: 1.4,
      }}
    >
      {kind === 'dark'
        ? 'Deep nebula surfaces, luminous accents. Designed first.'
        : 'Bright cream, restrained. A mirror for daylight work.'}
    </div>
  </button>
)

const CostRow: FC<{
  id: CostFormat
  label: string
  preview: string
  active: boolean
  onSelect: () => void
}> = ({ id: _id, label, preview, active, onSelect }) => (
  <button
    onClick={onSelect}
    style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 14px',
      background: active ? 'var(--surface-2)' : 'transparent',
      border: 'none',
      textAlign: 'left',
      cursor: 'pointer',
      color: 'inherit',
      font: 'inherit',
    }}
  >
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: active ? 'var(--accent)' : 'transparent',
        border: '1.5px solid ' + (active ? 'var(--accent)' : 'var(--border-strong)'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        flex: '0 0 auto',
      }}
    >
      {active ? <IconCheck size={10} /> : null}
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
      <div className="pc-mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>
        e.g. {preview}
      </div>
    </div>
  </button>
)
