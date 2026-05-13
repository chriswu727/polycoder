// iteration_messages CRUD. Captures the full LLM conversation for
// an iteration so Quick Edit follow-ups can resume with full context
// (prior file reads, prior edits, prior model reasoning) instead of
// starting over from scratch.

import type Database from 'better-sqlite3'
import type { ChatMessage, ChatToolCall } from '@providers/ModelProvider.js'

export function appendIterationMessages(
  db: Database.Database,
  iteration_id: string,
  messages: ChatMessage[],
): void {
  const insert = db.prepare(
    `INSERT INTO iteration_messages
       (iteration_id, seq, role, content, tool_calls_json, tool_call_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const tx = db.transaction((msgs: ChatMessage[]) => {
    msgs.forEach((m, i) => {
      const toolCalls =
        m.role === 'assistant' && m.tool_calls
          ? JSON.stringify(m.tool_calls)
          : null
      const toolCallId =
        m.role === 'tool' && m.tool_call_id ? m.tool_call_id : null
      insert.run(
        iteration_id,
        i,
        m.role,
        m.content,
        toolCalls,
        toolCallId,
      )
    })
  })
  tx(messages)
}

export function loadIterationMessages(
  db: Database.Database,
  iteration_id: string,
): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT role, content, tool_calls_json, tool_call_id
       FROM iteration_messages
       WHERE iteration_id = ?
       ORDER BY seq ASC`,
    )
    .all(iteration_id) as Array<{
      role: string
      content: string
      tool_calls_json: string | null
      tool_call_id: string | null
    }>

  return rows.map((r) => {
    const out = {
      role: r.role,
      content: r.content,
    } as ChatMessage
    if (r.tool_calls_json) {
      try {
        const parsed = JSON.parse(r.tool_calls_json) as ChatToolCall[]
        ;(out as { tool_calls?: ChatToolCall[] }).tool_calls = parsed
      } catch {
        // Bad JSON — drop the tool calls, keep the textual content.
      }
    }
    if (r.tool_call_id) {
      ;(out as { tool_call_id?: string }).tool_call_id = r.tool_call_id
    }
    return out
  })
}

export function hasIterationMessages(
  db: Database.Database,
  iteration_id: string,
): boolean {
  const row = db
    .prepare(
      'SELECT 1 as has_any FROM iteration_messages WHERE iteration_id = ? LIMIT 1',
    )
    .get(iteration_id) as { has_any: number } | undefined
  return !!row
}
