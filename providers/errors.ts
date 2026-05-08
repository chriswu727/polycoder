// ProviderError — uniform error shape across all providers. Adapters
// translate provider-native errors into this taxonomy. See docs/specs/
// providers.md §3.

import type { ProviderId } from '@core/types/workspace.js'
import type { ProviderErrorCode } from './ModelProvider.js'

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly providerId: ProviderId,
    readonly modelId: string,
    message: string,
    readonly retryable: boolean,
    readonly retry_after_ms?: number,
    readonly raw_error?: unknown,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/**
 * Map an HTTP status to a default error code. Adapters can override
 * with provider-specific logic when needed (e.g. distinguishing
 * quota_exceeded vs rate_limited from the response body).
 */
export function classifyHttpStatus(status: number): {
  code: ProviderErrorCode
  retryable: boolean
} {
  if (status === 401 || status === 403) {
    return { code: 'auth_failed', retryable: false }
  }
  if (status === 429) {
    return { code: 'rate_limited', retryable: true }
  }
  if (status === 400) {
    return { code: 'invalid_request', retryable: false }
  }
  if (status >= 500 && status < 600) {
    return { code: 'service_unavailable', retryable: true }
  }
  return { code: 'unknown', retryable: false }
}
