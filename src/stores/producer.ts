// Producer chat store — conversational state with the Producer agent.
// Lives per-workspace; loaded fresh when workspace changes.

import { create } from 'zustand'

export type ProducerMessage = {
  role: 'user' | 'assistant'
  content: string
  iteration_id: string | null
  ts: number
}

export type ProducerToolInvocation = {
  name: string
  brief: string
  ok: boolean
  ts: number
}

type ProducerStore = {
  workspaceId: string | null
  messages: ProducerMessage[]
  /** Tool invocations from the most recent Producer turn — surfaced
   *  in the meeting-room view so the user sees the team being
   *  dispatched. Cleared on new send. */
  liveToolInvocations: ProducerToolInvocation[]
  sending: boolean
  error: string | null
  totalCostUsd: number

  loadHistory: (workspace_id: string) => Promise<void>
  sendMessage: (workspace_id: string, message: string) => Promise<void>
  reset: () => void
}

export const useProducerStore = create<ProducerStore>((set, get) => ({
  workspaceId: null,
  messages: [],
  liveToolInvocations: [],
  sending: false,
  error: null,
  totalCostUsd: 0,

  reset() {
    set({
      messages: [],
      liveToolInvocations: [],
      sending: false,
      error: null,
      totalCostUsd: 0,
    })
  },

  async loadHistory(workspace_id) {
    if (get().workspaceId === workspace_id) return // already loaded
    set({
      workspaceId: workspace_id,
      messages: [],
      liveToolInvocations: [],
      error: null,
    })
    try {
      const res = await window.polycoder.producer.history({ workspace_id })
      if (!res.ok) {
        set({ error: 'failed to load producer history' })
        return
      }
      set({
        messages: res.messages.map((m) => ({
          role: m.role,
          content: m.content,
          iteration_id: m.iteration_id,
          ts: m.created_at,
        })),
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  async sendMessage(workspace_id, message) {
    const trimmed = message.trim()
    if (!trimmed || get().sending) return
    const now = Date.now()
    set((s) => ({
      messages: [
        ...s.messages,
        { role: 'user', content: trimmed, iteration_id: null, ts: now },
      ],
      liveToolInvocations: [],
      sending: true,
      error: null,
    }))
    try {
      const res = await window.polycoder.producer.send({
        workspace_id,
        message: trimmed,
      })
      if (!res.ok) {
        set({ error: res.error, sending: false })
        return
      }
      set((s) => ({
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            content: res.assistantText,
            iteration_id:
              res.iterationsCreated.length > 0
                ? res.iterationsCreated[res.iterationsCreated.length - 1]!
                : null,
            ts: Date.now(),
          },
        ],
        liveToolInvocations: res.toolInvocations.map((t) => ({
          name: t.name,
          brief: t.brief,
          ok: t.ok,
          ts: Date.now(),
        })),
        sending: false,
        totalCostUsd: s.totalCostUsd + res.producer_cost_usd,
      }))
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        sending: false,
      })
    }
  },
}))
