// Pipeline event bus — typed pub/sub for orchestrator → UI streaming.
// Per docs/specs/orchestrator.md §2.2.
//
// V0.1: simple in-memory subscriber list. The renderer subscribes
// via IPC (Layer H+) and gets pushed events as they fire.

import type { PipelineEvent } from '@core/types/iteration.js'

export type PipelineEventListener = (event: PipelineEvent) => void

export class PipelineEventBus {
  private listeners: Set<PipelineEventListener> = new Set()

  emit(event: PipelineEvent): void {
    for (const l of this.listeners) {
      try {
        l(event)
      } catch (e) {
        // Listener errors must not break the orchestrator. Surface
        // to console for debugging.
        // eslint-disable-next-line no-console
        console.error('PipelineEventBus listener threw:', e)
      }
    }
  }

  subscribe(listener: PipelineEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Listener count — useful in tests. */
  size(): number {
    return this.listeners.size
  }
}
