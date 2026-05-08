// Minimal tab bar — controlled. No portals, no animation, plain a11y.

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn.js'

export type TabItem<K extends string> = {
  key: K
  label: ReactNode
  badge?: ReactNode
}

export type TabsProps<K extends string> = {
  items: TabItem<K>[]
  active: K
  onChange: (key: K) => void
  className?: string
}

export function Tabs<K extends string>({ items, active, onChange, className }: TabsProps<K>) {
  return (
    <div
      role="tablist"
      className={cn('flex border-b border-slate-200', className)}
    >
      {items.map((item) => {
        const selected = item.key === active
        return (
          <button
            key={item.key}
            role="tab"
            aria-selected={selected}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              'relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors',
              selected
                ? 'border-b-2 border-blue-600 -mb-px text-slate-900'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {item.label}
            {item.badge}
          </button>
        )
      })}
    </div>
  )
}
