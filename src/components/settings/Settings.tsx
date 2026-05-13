// Settings shell — design's tabs-in-header strip + scrollable
// content area. The Secrets and Team panels keep the V0.1
// implementations underneath (they work; the internal visual
// language is the V0.1.2 follow-up). The shell + tabs are
// design-faithful.

import { useState } from 'react'
import type { FC } from 'react'

import { SecretsTab } from './SecretsTab.js'
import { TeamConfigTab } from './TeamConfigTab.js'
import { PreferencesTab } from './PreferencesTab.js'
import { IconCpu, IconKey, IconSettings } from '@/components/icons.js'

type Section = 'secrets' | 'team' | 'preferences'

export const Settings: FC<{ initialSection?: Section }> = ({
  initialSection = 'secrets',
}) => {
  const [section, setSection] = useState<Section>(initialSection)

  return (
    <div
      className="pane"
      style={{ flex: 1, gridColumn: '2 / span 2', borderLeft: '1px solid var(--hairline)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '12px 16px',
          borderBottom: '1px solid var(--hairline)',
          background: 'var(--bg-2)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginRight: 12 }}>Settings</div>
        {(
          [
            { id: 'secrets', label: 'Secrets', Icon: IconKey },
            { id: 'team', label: 'Team', Icon: IconCpu },
            { id: 'preferences', label: 'Preferences', Icon: IconSettings },
          ] as const
        ).map((t) => {
          const active = section === t.id
          const Icon = t.Icon
          return (
            <button
              key={t.id}
              onClick={() => setSection(t.id)}
              className="pc-btn"
              data-variant={active ? '' : 'ghost'}
              data-size="sm"
              style={{
                background: active ? 'var(--surface)' : 'transparent',
                borderColor: active ? 'var(--border)' : 'transparent',
              }}
            >
              <Icon size={12} /> {t.label}
            </button>
          )
        })}
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {section === 'secrets' ? (
            <>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: '-0.015em',
                  marginBottom: 4,
                }}
              >
                Provider keys
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--ink-2)',
                  marginBottom: 18,
                  lineHeight: 1.5,
                }}
              >
                Keys for each AI provider you want polycoder to use. Stored in
                the OS keychain. Not synced. Sent only to the provider when
                calling their API.
              </div>
              <SecretsTab />
            </>
          ) : section === 'team' ? (
            <>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: '-0.015em',
                  marginBottom: 4,
                }}
              >
                Team configuration
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--ink-2)',
                  marginBottom: 18,
                  lineHeight: 1.5,
                }}
              >
                Which model handles which step. Pick a preset, or override
                individual roles.
              </div>
              <TeamConfigTab />
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: '-0.015em',
                  marginBottom: 4,
                }}
              >
                Preferences
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--ink-2)',
                  marginBottom: 18,
                  lineHeight: 1.5,
                }}
              >
                How polycoder looks and reads to you. Saved on this computer.
              </div>
              <PreferencesTab />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
