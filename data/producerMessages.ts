// Producer conversation history CRUD. The Producer (项目经理) is a
// conversational agent layered on top of the 8-role pipeline. Each
// user message + Producer reply persists per workspace.

import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { ChatMessage, ChatToolCall } from '@providers/ModelProvider.js'

export type ProducerMessageRow = {
  id: string
  workspace_id: string
  seq: number
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
  iteration_id?: string
  created_at: number
}

export function nextProducerSeq(
  db: Database.Database,
  workspace_id: string,
): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(seq), -1) + 1 as next FROM producer_messages WHERE workspace_id = ?',
    )
    .get(workspace_id) as { next: number }
  return row.next
}

export function appendProducerMessages(
  db: Database.Database,
  workspace_id: string,
  messages: ChatMessage[],
  meta?: { iteration_id?: string },
): void {
  let seq = nextProducerSeq(db, workspace_id)
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO producer_messages
       (id, workspace_id, seq, role, content, tool_calls_json, tool_call_id,
        iteration_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const tx = db.transaction((msgs: ChatMessage[]) => {
    for (const m of msgs) {
      // skip system messages — Producer's system prompt is rebuilt
      // fresh each turn, no need to persist.
      if (m.role === 'system') continue
      const toolCallsJson =
        m.role === 'assistant' && m.tool_calls
          ? JSON.stringify(m.tool_calls)
          : null
      const toolCallId =
        m.role === 'tool' && m.tool_call_id ? m.tool_call_id : null
      insert.run(
        randomUUID(),
        workspace_id,
        seq++,
        m.role,
        m.content,
        toolCallsJson,
        toolCallId,
        meta?.iteration_id ?? null,
        now,
      )
    }
  })
  tx(messages)
}

export function loadProducerMessages(
  db: Database.Database,
  workspace_id: string,
): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT role, content, tool_calls_json, tool_call_id
       FROM producer_messages
       WHERE workspace_id = ?
       ORDER BY seq ASC`,
    )
    .all(workspace_id) as Array<{
      role: string
      content: string
      tool_calls_json: string | null
      tool_call_id: string | null
    }>
  return rows.map((r) => {
    const out = { role: r.role, content: r.content } as ChatMessage
    if (r.tool_calls_json) {
      try {
        const parsed = JSON.parse(r.tool_calls_json) as ChatToolCall[]
        ;(out as { tool_calls?: ChatToolCall[] }).tool_calls = parsed
      } catch {
        // drop bad tool_calls
      }
    }
    if (r.tool_call_id) {
      ;(out as { tool_call_id?: string }).tool_call_id = r.tool_call_id
    }
    return out
  })
}

/** Producer-tagged messages with metadata, for the renderer history
 *  pane. Skips internal tool messages — only user + assistant text. */
export type ProducerHistoryEntry = {
  role: 'user' | 'assistant'
  content: string
  iteration_id: string | null
  created_at: number
}

export function listProducerHistory(
  db: Database.Database,
  workspace_id: string,
  limit = 200,
): ProducerHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT role, content, iteration_id, created_at
       FROM producer_messages
       WHERE workspace_id = ? AND role IN ('user', 'assistant')
       ORDER BY seq ASC
       LIMIT ?`,
    )
    .all(workspace_id, limit) as Array<{
      role: string
      content: string
      iteration_id: string | null
      created_at: number
    }>
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
      iteration_id: r.iteration_id ?? null,
      created_at: r.created_at,
    }))
}

export function clearProducerHistory(
  db: Database.Database,
  workspace_id: string,
): void {
  db.prepare(
    'DELETE FROM producer_messages WHERE workspace_id = ?',
  ).run(workspace_id)
}
