// CostTracker — accumulates per-role usage records during one
// iteration. Persisted via data/costRecords.ts at iteration end.
// Per docs/specs/orchestrator.md §8.

import type { RoleType } from '@core/types/role.js'
import type { ProviderId } from '@core/types/workspace.js'
import type { TokenUsage } from '@core/types/cost.js'

export type CostEntry = {
  role: RoleType
  provider: ProviderId
  model: string
  usage: TokenUsage
  duration_ms: number
  recorded_at: number
}

export class CostTracker {
  private entries: CostEntry[] = []

  record(entry: Omit<CostEntry, 'recorded_at'>): void {
    this.entries.push({ ...entry, recorded_at: Date.now() })
  }

  perRoleTotals(): Map<RoleType, number> {
    const out = new Map<RoleType, number>()
    for (const e of this.entries) {
      out.set(e.role, (out.get(e.role) ?? 0) + e.usage.estimated_cost_usd)
    }
    return out
  }

  perModelTotals(): Map<string, number> {
    const out = new Map<string, number>()
    for (const e of this.entries) {
      out.set(e.model, (out.get(e.model) ?? 0) + e.usage.estimated_cost_usd)
    }
    return out
  }

  iterationTotal(): number {
    return this.entries.reduce(
      (acc, e) => acc + e.usage.estimated_cost_usd,
      0,
    )
  }

  iterationDuration(): number {
    return this.entries.reduce((acc, e) => acc + e.duration_ms, 0)
  }

  /** Snapshot of all entries (read-only copy). */
  snapshot(): readonly CostEntry[] {
    return [...this.entries]
  }
}
