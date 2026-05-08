import { describe, it, expect } from 'vitest'
import { AnthropicProvider } from './AnthropicProvider.js'
import type { FetchImpl } from './httpClient.js'

function makeFetch(responder: (req: { url: string; init: RequestInit | undefined }) => Response): FetchImpl {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    return Promise.resolve(responder({ url, init }))
  }) as FetchImpl
}

describe('AnthropicProvider.chat', () => {
  it('extracts system messages into top-level system field', async () => {
    let capturedBody: Record<string, unknown> | null = null
    const fetchImpl = makeFetch(({ init }) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
      }
      return new Response(
        JSON.stringify({
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', fetchImpl })
    const resp = await p.chat({
      model: 'claude-haiku-4-5-20251001',
      messages: [
        { role: 'system', content: 'You are an architect.' },
        { role: 'user', content: 'design a todo app' },
      ],
    })

    expect(resp.content).toBe('hello')
    expect(resp.finish_reason).toBe('stop')
    expect(capturedBody).not.toBeNull()
    const body = capturedBody as unknown as Record<string, unknown>
    expect(body.system).toBe('You are an architect.')
    expect((body.messages as Array<{ role: string }>)[0]?.role).toBe('user')
  })

  it('translates tool_use content blocks into ChatToolCalls', async () => {
    const fetchImpl = makeFetch(() =>
      new Response(
        JSON.stringify({
          id: 'msg-2',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'read_file',
              input: { path: 'src/foo.ts' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl })
    const resp = await p.chat({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'read foo' }],
    })

    expect(resp.tool_calls).toHaveLength(1)
    expect(resp.tool_calls[0]?.name).toBe('read_file')
    expect(resp.tool_calls[0]?.arguments).toEqual({ path: 'src/foo.ts' })
    expect(resp.finish_reason).toBe('tool_use')
  })

  it('uses x-api-key + anthropic-version headers (not Authorization: Bearer)', async () => {
    let capturedHeaders: Record<string, string> | null = null
    const fetchImpl = makeFetch(({ init }) => {
      capturedHeaders = init?.headers as Record<string, string>
      return new Response(
        JSON.stringify({
          id: 'msg',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const p = new AnthropicProvider({ apiKey: 'sk-ant-secret', fetchImpl })
    await p.chat({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(capturedHeaders).not.toBeNull()
    const h = capturedHeaders as unknown as Record<string, string>
    expect(h['x-api-key']).toBe('sk-ant-secret')
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(h['Authorization']).toBeUndefined()
  })

  it('handles 401 → ProviderError with auth_failed', async () => {
    const fetchImpl = makeFetch(() =>
      new Response(JSON.stringify({ type: 'error', error: { message: 'bad key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const p = new AnthropicProvider({ apiKey: 'bad', fetchImpl })
    await expect(
      p.chat({
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'auth_failed' })
  })

  it('translates tool message into user-role with tool_result block', async () => {
    let captured: Record<string, unknown> | null = null
    const fetchImpl = makeFetch(({ init }) => {
      if (init?.body) captured = JSON.parse(init.body as string) as Record<string, unknown>
      return new Response(
        JSON.stringify({
          id: 'msg',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl })
    await p.chat({
      model: 'claude-haiku-4-5-20251001',
      messages: [
        { role: 'user', content: 'read it' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'tc-1', name: 'read_file', arguments: { path: 'x' } }],
        },
        { role: 'tool', content: 'file contents...', tool_call_id: 'tc-1' },
      ],
    })

    expect(captured).not.toBeNull()
    const body = captured as unknown as { messages: Array<Record<string, unknown>> }
    const toolMsg = body.messages[2]
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.role).toBe('user')
    const blocks = toolMsg?.content as Array<{ type: string; tool_use_id?: string }>
    expect(blocks[0]?.type).toBe('tool_result')
    expect(blocks[0]?.tool_use_id).toBe('tc-1')
  })
})

describe('AnthropicProvider.stream', () => {
  it('parses event-typed stream into content_delta + tool_call events', async () => {
    const events = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-s1","usage":{"input_tokens":3}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi "}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"there"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu-1","name":"read_file","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"x.ts\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('')

    const fetchImpl = makeFetch(() =>
      new Response(events, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )

    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl })
    const collected = []
    for await (const e of p.stream({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      collected.push(e)
    }

    const deltas = collected
      .filter((e) => e.type === 'content_delta')
      .map((e) => (e.type === 'content_delta' ? e.delta : ''))
    expect(deltas).toEqual(['hi ', 'there'])

    const toolStart = collected.find((e) => e.type === 'tool_call_start')
    expect(toolStart?.type).toBe('tool_call_start')

    const toolEnd = collected.find((e) => e.type === 'tool_call_end')
    expect(toolEnd?.type).toBe('tool_call_end')
    if (toolEnd?.type === 'tool_call_end') {
      expect(toolEnd.full_arguments).toEqual({ path: 'x.ts' })
    }

    const complete = collected.find((e) => e.type === 'message_complete')
    expect(complete?.type).toBe('message_complete')
    if (complete?.type === 'message_complete') {
      expect(complete.response.content).toBe('hi there')
      expect(complete.response.finish_reason).toBe('tool_use')
      expect(complete.response.usage.input_tokens).toBe(3)
      expect(complete.response.usage.output_tokens).toBe(7)
    }
  })

  it('emits error event on non-200', async () => {
    const fetchImpl = makeFetch(() =>
      new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '3' },
      }),
    )
    const p = new AnthropicProvider({ apiKey: 'k', fetchImpl })
    const events = []
    for await (const e of p.stream({
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      events.push(e)
    }
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('error')
    if (events[0]?.type === 'error') {
      expect(events[0].error.code).toBe('rate_limited')
      expect(events[0].error.retry_after_ms).toBe(3000)
    }
  })
})
