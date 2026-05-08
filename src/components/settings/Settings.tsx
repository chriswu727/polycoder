import { useState } from 'react'
import { Tabs } from '@/components/ui/Tabs.js'
import { SecretsTab } from './SecretsTab.js'
import { TeamConfigTab } from './TeamConfigTab.js'

type SettingsTab = 'secrets' | 'team'

export function Settings() {
  const [tab, setTab] = useState<SettingsTab>('secrets')

  return (
    <div className="space-y-4">
      <Tabs<SettingsTab>
        active={tab}
        onChange={setTab}
        items={[
          { key: 'secrets', label: 'Secrets' },
          { key: 'team', label: 'Team' },
        ]}
      />
      {tab === 'secrets' ? <SecretsTab /> : <TeamConfigTab />}
    </div>
  )
}
