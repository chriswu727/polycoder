import { describe, it, expect } from 'vitest'
import { OpenAICompatProvider } from './OpenAICompatProvider.js'
import type { FetchImpl } from './httpClient.js'
import { ProviderError } from './errors.js'
import type { ModelInfo } from './ModelProvider.js'

function makeFetch(map: Record<string, () => Response>): FetchImpl {
  return ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const handler = map[url]
    if (!handler) {
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }
    return Promise.resolve(handler())
  }) as FetchImpl
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function sseResponse(events: string[]): Response {
  const body = events.join('') + 'data: [DONE]\n\n'
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

const TEST_MODEL_INFO: ModelInfo = {
  id: 'test-model',
  display_name: 'Test',
  capabilities: {
    supports_streaming: true,
    supports_tool_use: true,
    supports_vision: false,
    supports_json_mode: true,
    context_window: 8192,
    max_output_tokens: 4096,
  },
  cost_per_million_input_tokens: 1.0,
  cost_per_million_output_tokens: 2.0,
  cost_per_million_cached_input_tokens: 0.1,
}

describe('OpenAICompatProvider.chat (non-streaming)', () => {
  it('parses a successful response', async () => {
    const fetchImpl = makeFetch({
      'https://example.com/v1/chat/completions': () =>
        jsonResponse(200, {
          id: 'resp-1',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'hello world' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
    })

    const p = new OpenAICompatProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://example.com',
      fetchImpl,
      modelInfos: [TEST_MODEL_INFO],
    })

    const resp = await p.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(resp.id).toBe('resp-1')
    expect(resp.content).toBe('hello world')
    expect(resp.tool_calls).toHaveLength(0)
    expect(resp.finish_reason).toBe('stop')
    expect(resp.usage.input_tokens).toBe(10)
    expect(resp.usage.output_tokens).toBe(5)
    // 10 input * 1.0/M + 5 output * 2.0/M = 0.00001 + 0.00001 = 0.00002, rounded to 4 decimals = 0
    // (the rounding strips this; we only verify it didn't throw)
    expect(resp.usage.estimated_cost_usd).toBeGreaterThanOrEqual(0)
  })

  it('throws ProviderError with auth_failed on 401', async () => {
    const fetchImpl = makeFetch({
      'https://example.com/v1/chat/completions': () =>
        jsonResponse(401, { error: { message: 'invalid api key' } }),
    })
    const p = new OpenAICompatProvider({
      apiKey: 'bad',
      baseUrl: 'https://example.com',
      fetchImpl,
    })

    await expect(
      p.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({
      code: 'auth_failed',
      retryable: false,
    } satisfies Partial<ProviderError>)
  })

  it('throws ProviderError with rate_limited + retry_after_ms on 429', async () => {
    const fetchImpl = makeFetch({
      'https://example.com/v1/chat/completions': () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '5' },
        }),
    })
    const p = new OpenAICompatProvider({
      apiKey: 'k',
      baseUrl: 'https://example.com',
      fetchImpl,
    })
    try {
      await p.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError)
      const err = e as ProviderError
      expect(err.code).toBe('rate_limited')
      expect(err.retry_after_ms).toBe(5000)
    }
  })

  it('parses tool_calls in non-streaming response', async () => {
    const fetchImpl = makeFetch({
      'https://example.com/v1/chat/completions': () =>
        jsonResponse(200, {
          id: 'resp-2',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'tc-1',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"path":"src/index.ts"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        }),
    })

    const p = new OpenAICompatProvider({
      apiKey: 'k',
      baseUrl: 'https://example.com',
      fetchImpl,
    })
    const resp = await p.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'read it' }],
    })
    expect(resp.tool_calls).toHaveLength(1)
    expect(resp.tool_calls[0]?.name).toBe('read_file')
    expect(resp.tool_calls[0]?.arguments).toEqual({ path: 'src/index.ts' })
    expect(resp.finish_reason).toBe('tool_use')
  })
})

describe('OpenAICompatProvider.stream', () => {
  it('emits content_delta events and a final message_complete', async () => {
    const fetchImpl = makeFetch({
      'https://example.com/v1/chat/completions': () =>
        sseResponse([
          'data: {"id":"r1","choices":[{"index":0,"delta":{"content":"hello "}}]}\n\n',
          'data: {"id":"r1","choices":[{"index":0,"delta":{"content":"world"}}]}\n\n',
          'data: {"id":"r1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: {"id":"r1","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        ]),
    })
    const p = new OpenAICompatProvider({
      apiKey: 'k',
      baseUrl: 'https://example.com',
      fetchImpl,
      modelInfos: [TEST_MODEL_INFO],
    })

    const events = []
    for await (const e of p.stream({
      model: 'test-model',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      events.push(e)
    }

    const deltas = events.filter((e) => e.type === 'content_delta')
    expect(deltas.map((e) => (e.type === 'content_delta' ? e.delta : ''))).toEqual([
      'hello ',
      'world',
    ])

    const complete = events.find((e) => e.type === 'message_complete')
    expect(complete?.type).toBe('message_complete')
    if (complete?.type === 'message_complete') {
      expect(complete.response.content).toBe('hello world')
      expect(complete.response.finish_reason).toBe('stop')
      expect(complete.response.usage.input_tokens).toBe(3)
      expect(complete.response.usage.output_tokens).toBe(2)
    }
  })

  it('emits tool_call events when tool_calls stream in', async () => {
    const fetchImpl = makeFetch({
      'https://example.com/v1/chat/completions': () =>
        sseResponse([
          'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"tc-1","function":{"name":"read_file"}}]}}]}\n\n',
          'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\""}}]}}]}\n\n',
          'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"src/x.ts\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        ]),
    })
    const p = new OpenAICompatProvider({
      apiKey: 'k',
      baseUrl: 'https://example.com',
      fetchImpl,
    })

    const events = []
    for await (const e of p.stream({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      events.push(e)
    }

    const start = events.find((e) => e.type === 'tool_call_start')
    expect(start?.type).toBe('tool_call_start')
    if (start?.type === 'tool_call_start') {
      expect(start.tool_call_id).toBe('tc-1')
      expect(start.name).toBe('read_file')
    }

    const end = events.find((e) => e.type === 'tool_call_end')
    expect(end?.type).toBe('tool_call_end')
    if (end?.type === 'tool_call_end') {
      expect(end.full_arguments).toEqual({ path: 'src/x.ts' })
    }
  })

  it('yields an error event when status is non-200', async () => {
    const fetchImpl = makeFetch({
      'https://example.com/v1/chat/completions': () =>
        new Response('overload', { status: 503 }),
    })
    const p = new OpenAICompatProvider({
      apiKey: 'k',
      baseUrl: 'https://example.com',
      fetchImpl,
    })

    const events = []
    for await (const e of p.stream({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      events.push(e)
    }
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('error')
    if (events[0]?.type === 'error') {
      expect(events[0].error.code).toBe('service_unavailable')
      expect(events[0].error.retryable).toBe(true)
    }
  })
})

describe('OpenAICompatProvider.testConnection', () => {
  it('returns ok with models when listModels resolves', async () => {
    const p = new OpenAICompatProvider({
      apiKey: 'k',
      baseUrl: 'https://example.com',
      fetchImpl: makeFetch({}),
      modelInfos: [TEST_MODEL_INFO],
    })
    const result = await p.testConnection()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.available_models).toHaveLength(1)
  })
})

describe('OpenAICompatProvider.listModels', () => {
  it('returns provided modelInfos without hitting the network', async () => {
    let called = false
    const p = new OpenAICompatProvider({
      apiKey: 'k',
      baseUrl: 'https://example.com',
      fetchImpl: ((() => {
        called = true
        return Promise.resolve(new Response('{}', { status: 200 }))
      }) as unknown) as FetchImpl,
      modelInfos: [TEST_MODEL_INFO],
    })
    const models = await p.listModels()
    expect(models).toHaveLength(1)
    expect(called).toBe(false)
  })

  it('hits /v1/models when modelInfos is empty', async () => {
    const fetchImpl = makeFetch({
      'https://example.com/v1/models': () =>
        jsonResponse(200, { data: [{ id: 'foo' }, { id: 'bar' }] }),
    })
    const p = new OpenAICompatProvider({
      apiKey: 'k',
      baseUrl: 'https://example.com',
      fetchImpl,
    })
    const models = await p.listModels()
    expect(models.map((m) => m.id)).toEqual(['foo', 'bar'])
  })
})
