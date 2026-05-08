// Tiny fetch wrapper used by adapters. Adds:
//   * Composable abort: caller AbortSignal merged with our internal timeout signal
//   * Mockable: callers may pass a custom fetch implementation (tests use this)
//   * Uniform timeout default

export type FetchImpl = typeof fetch

export type HttpRequestOptions = {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: string
  /** Caller's abort signal; we merge with internal timeout. */
  signal?: AbortSignal
  /** Default 60s. */
  timeout_ms?: number
  /** For tests; defaults to globalThis.fetch. */
  fetchImpl?: FetchImpl
}

export type HttpResponse = {
  status: number
  headers: Headers
  body: ReadableStream<Uint8Array> | null
  text(): Promise<string>
  json(): Promise<unknown>
}

export const DEFAULT_TIMEOUT_MS = 60_000

export async function httpRequest(opts: HttpRequestOptions): Promise<HttpResponse> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const timeoutMs = opts.timeout_ms ?? DEFAULT_TIMEOUT_MS

  const internalCtrl = new AbortController()
  const timer = setTimeout(() => internalCtrl.abort('timeout'), timeoutMs)

  const signal = composeSignals(opts.signal, internalCtrl.signal)

  const init: RequestInit = {
    method: opts.method,
    headers: opts.headers,
    signal,
  }
  if (opts.body !== undefined) {
    init.body = opts.body
  }

  let resp: Response
  try {
    resp = await fetchImpl(opts.url, init)
  } finally {
    clearTimeout(timer)
  }

  return {
    status: resp.status,
    headers: resp.headers,
    body: resp.body,
    text: () => resp.text(),
    json: () => resp.json(),
  }
}

/**
 * Merge two AbortSignals into one that fires on either.
 * (AbortSignal.any exists in Node 20+, but uniform handling in older
 * environments is safer.)
 */
function composeSignals(
  a: AbortSignal | undefined,
  b: AbortSignal,
): AbortSignal {
  if (!a) return b
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([a, b])
  }
  // Fallback for older runtimes.
  const ctrl = new AbortController()
  const onAAbort = () => ctrl.abort(a.reason)
  const onBAbort = () => ctrl.abort(b.reason)
  if (a.aborted) ctrl.abort(a.reason)
  else a.addEventListener('abort', onAAbort, { once: true })
  if (b.aborted) ctrl.abort(b.reason)
  else b.addEventListener('abort', onBAbort, { once: true })
  return ctrl.signal
}
