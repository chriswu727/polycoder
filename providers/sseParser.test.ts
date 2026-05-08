import { describe, it, expect } from 'vitest'
import { parseSse } from './sseParser.js'

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(s))
      controller.close()
    },
  })
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of iter) out.push(x)
  return out
}

describe('parseSse', () => {
  it('parses a single OpenAI-style data event', async () => {
    const events = await collect(
      parseSse(streamFromString('data: {"hello":"world"}\n\n')),
    )
    expect(events).toEqual([{ event: undefined, data: '{"hello":"world"}' }])
  })

  it('parses multiple events', async () => {
    const events = await collect(
      parseSse(
        streamFromString(
          'data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n',
        ),
      ),
    )
    expect(events).toHaveLength(3)
    expect(events[2]?.data).toBe('[DONE]')
  })

  it('parses Anthropic-style event:type lines', async () => {
    const events = await collect(
      parseSse(
        streamFromString(
          'event: message_start\ndata: {"type":"message_start"}\n\nevent: content_block_delta\ndata: {"delta":"x"}\n\n',
        ),
      ),
    )
    expect(events[0]?.event).toBe('message_start')
    expect(events[1]?.event).toBe('content_block_delta')
  })

  it('handles events split across chunks', async () => {
    const events = await collect(
      parseSse(streamFromChunks(['data: {"hel', 'lo":"world"}\n\n'])),
    )
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toBe('{"hello":"world"}')
  })

  it('skips comment lines starting with colon', async () => {
    const events = await collect(
      parseSse(streamFromString(': keep-alive\n\ndata: {"x":1}\n\n')),
    )
    // First block has no data — skipped.
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toBe('{"x":1}')
  })

  it('joins multi-line data with \\n', async () => {
    const events = await collect(
      parseSse(streamFromString('data: line1\ndata: line2\n\n')),
    )
    expect(events[0]?.data).toBe('line1\nline2')
  })

  it('handles \\r\\n line endings', async () => {
    const events = await collect(
      parseSse(streamFromString('data: {"a":1}\r\n\r\n')),
    )
    expect(events[0]?.data).toBe('{"a":1}')
  })
})
