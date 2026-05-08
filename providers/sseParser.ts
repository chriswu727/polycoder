// Server-Sent Events parser. Consumes a ReadableStream of bytes and
// yields parsed events. Handles the spec's `\n\n` event separator,
// optional `event:` line, and multi-line `data:` accumulation.
// OpenAI/DeepSeek/Qwen/GLM/Anthropic all stream SSE; the only variation
// is whether they include `event:` (Anthropic does, OpenAI doesn't).

export type SseEvent = {
  /** The event name, or undefined for default-named events (`data:`-only). */
  event?: string
  /** Raw data payload (single string; multi-line `data:` lines are joined with `\n`). */
  data: string
}

/**
 * Parse a ReadableStream<Uint8Array> as SSE. Yields each complete event.
 * Stops when the stream closes. Caller is responsible for handling
 * abort/error externally — errors thrown during read propagate.
 */
export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<SseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        // Flush any remaining partial event.
        const final = parseEventBlock(buffer.trim())
        if (final) yield final
        return
      }

      buffer += decoder.decode(value, { stream: true })

      let sep: number
      while ((sep = findEventSeparator(buffer)) !== -1) {
        const block = buffer.slice(0, sep)
        const sepLen = buffer[sep] === '\r' ? 4 : 2 // \r\n\r\n vs \n\n
        buffer = buffer.slice(sep + sepLen)
        const evt = parseEventBlock(block)
        if (evt) yield evt
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Find the index of the next event separator (\n\n or \r\n\r\n) in the buffer.
 * Returns -1 if not present. Returns the index of the FIRST `\n` (or `\r`).
 */
function findEventSeparator(buf: string): number {
  // Prefer \r\n\r\n if present.
  const crlf = buf.indexOf('\r\n\r\n')
  const lf = buf.indexOf('\n\n')
  if (crlf === -1) return lf
  if (lf === -1) return crlf
  return Math.min(crlf, lf)
}

function parseEventBlock(block: string): SseEvent | null {
  if (!block) return null
  const lines = block.split(/\r?\n/)
  let event: string | undefined = undefined
  const dataParts: string[] = []
  for (const line of lines) {
    if (line.startsWith(':')) continue // SSE comment
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).replace(/^ /, ''))
    }
    // We ignore `id:` and `retry:` for our purposes.
  }
  if (dataParts.length === 0 && event === undefined) return null
  const result: SseEvent = { data: dataParts.join('\n') }
  if (event !== undefined) result.event = event
  return result
}
