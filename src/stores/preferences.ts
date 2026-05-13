// User preferences store — persisted to localStorage. Currently
// holds the light/dark theme and the cost-format preference.
// Keeps the IPC store + workspace store unpolluted with UI-only
// concerns.

import { create } from 'zustand'

export type ThemePref = 'light' | 'dark'
export type CostFormat = 'dollars' | 'friendly'

type Prefs = {
  theme: ThemePref
  costFormat: CostFormat
}

type PrefsStore = Prefs & {
  setTheme: (t: ThemePref) => void
  setCostFormat: (f: CostFormat) => void
  toggleTheme: () => void
}

const STORAGE_KEY = 'polycoder.prefs.v1'

function loadInitial(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>
      return {
        theme: parsed.theme === 'light' ? 'light' : 'dark',
        costFormat: parsed.costFormat === 'dollars' ? 'dollars' : 'friendly',
      }
    }
  } catch {
    // ignore parse errors; fall through to default
  }
  // Default: dark (V3 design's primary canvas), friendly cost format
  return { theme: 'dark', costFormat: 'friendly' }
}

function persist(p: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // ignore quota / private-browsing errors
  }
}

export const usePreferencesStore = create<PrefsStore>((set, get) => ({
  ...loadInitial(),

  setTheme(t) {
    set({ theme: t })
    persist({ ...get() })
  },
  setCostFormat(f) {
    set({ costFormat: f })
    persist({ ...get() })
  },
  toggleTheme() {
    const next: ThemePref = get().theme === 'dark' ? 'light' : 'dark'
    set({ theme: next })
    persist({ ...get() })
  },
}))

// Friendly cost formatter — "约 6 分钱" feel for sub-dollar costs,
// dollars otherwise. The friendly variant degrades to English so
// users don't need a CJK font to read it.
export function formatCost(usd: number, format: CostFormat): string {
  if (format === 'dollars') return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`
  if (usd < 0.005) return '< 1¢'
  if (usd < 1) return `~${Math.round(usd * 100)}¢`
  if (usd < 10) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(1)}`
}
