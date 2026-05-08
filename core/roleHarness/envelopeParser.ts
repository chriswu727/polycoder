// envelopeParser — extracts the `<role-output>` envelope from a
// model's response text and parses its payload as JSON. Per
// ADR-010 + docs/specs/orchestrator.md §6.
//
// Robustness: models occasionally add prose before/after the
// envelope (despite our prompts), so we extract the FIRST
// `<role-output>...</role-output>` block and ignore surrounding
// text. We also tolerate trailing newlines, code fences around
// the envelope, and minor formatting drift inside `<payload>`.

import type { RoleType, RoleOutputStatus } from '@core/types/role.js'

export type ParsedEnvelope = {
  role: RoleType
  iteration: number
  model: string
  status: RoleOutputStatus
  summary: string
  payload: unknown
}

export type ParseFailureReason =
  | { code: 'no_envelope' }
  | { code: 'multiple_envelopes' }
  | { code: 'malformed_attributes'; detail: string }
  | { code: 'missing_payload' }
  | { code: 'payload_not_json'; detail: string }
  | { code: 'invalid_status'; detail: string }
  | { code: 'invalid_iteration'; detail: string }

export class EnvelopeParseError extends Error {
  constructor(
    readonly reason: ParseFailureReason,
    message: string,
  ) {
    super(message)
    this.name = 'EnvelopeParseError'
  }
}

const ENVELOPE_RE = /<role-output\b([^>]*)>([\s\S]*?)<\/role-output>/g

const VALID_STATUSES: ReadonlySet<RoleOutputStatus> = new Set<RoleOutputStatus>([
  'ok',
  'flagged',
  'failed',
  'partial',
  'cannot_run',
  'cannot_assess',
  'clean',
  'passed',
  'needs_clarification',
  'conflict_detected',
  'memory_only',
  'incomplete',
  'healthy',
  'warning',
  'critical',
  'green',
  'yellow',
  'red',
])

const VALID_ROLES: ReadonlySet<RoleType> = new Set<RoleType>([
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
])

/**
 * Parse the model's response text and extract the (single) role-output
 * envelope. Throws EnvelopeParseError on malformed input.
 */
export function parseRoleOutput(text: string): ParsedEnvelope {
  // Remove markdown code fences that might wrap the envelope.
  const stripped = stripCodeFences(text).trim()

  ENVELOPE_RE.lastIndex = 0
  const matches: Array<{ attrs: string; body: string }> = []
  let m: RegExpExecArray | null
  while ((m = ENVELOPE_RE.exec(stripped)) !== null) {
    matches.push({ attrs: m[1] ?? '', body: m[2] ?? '' })
  }

  if (matches.length === 0) {
    throw new EnvelopeParseError(
      { code: 'no_envelope' },
      'No <role-output> envelope found in response.',
    )
  }
  if (matches.length > 1) {
    throw new EnvelopeParseError(
      { code: 'multiple_envelopes' },
      `Found ${matches.length} <role-output> envelopes; expected exactly 1.`,
    )
  }

  const only = matches[0]!
  const { role, iteration, model } = parseAttributes(only.attrs)
  const { status, summary, payload } = parseBody(only.body)

  return { role, iteration, model, status, summary, payload }
}

function parseAttributes(attrText: string): {
  role: RoleType
  iteration: number
  model: string
} {
  const attrs: Record<string, string> = {}
  const re = /(\w+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrText)) !== null) {
    if (m[1]) attrs[m[1]] = m[2] ?? ''
  }

  if (!attrs.role || !VALID_ROLES.has(attrs.role as RoleType)) {
    throw new EnvelopeParseError(
      { code: 'malformed_attributes', detail: `role attribute missing or unknown: "${attrs.role ?? ''}"` },
      `Invalid role attribute: "${attrs.role ?? ''}".`,
    )
  }
  const role = attrs.role as RoleType

  if (!attrs.iteration) {
    throw new EnvelopeParseError(
      { code: 'invalid_iteration', detail: 'iteration attribute missing' },
      'Missing iteration attribute.',
    )
  }
  const iteration = Number(attrs.iteration)
  if (!Number.isFinite(iteration) || !Number.isInteger(iteration) || iteration < 0) {
    throw new EnvelopeParseError(
      { code: 'invalid_iteration', detail: `iteration="${attrs.iteration}"` },
      `Iteration must be a non-negative integer; got ${attrs.iteration}.`,
    )
  }

  // Model attribute is required but we tolerate empty / placeholder
  // strings the orchestrator will overwrite.
  const model = attrs.model ?? ''

  return { role, iteration, model }
}

function parseBody(body: string): {
  status: RoleOutputStatus
  summary: string
  payload: unknown
} {
  // Status: <status>...</status>
  const statusMatch = body.match(/<status>\s*([^<]*?)\s*<\/status>/)
  if (!statusMatch || !statusMatch[1]) {
    throw new EnvelopeParseError(
      { code: 'invalid_status', detail: 'status tag missing or empty' },
      'Missing or empty <status> tag.',
    )
  }
  const status = statusMatch[1].trim() as RoleOutputStatus
  if (!VALID_STATUSES.has(status)) {
    throw new EnvelopeParseError(
      { code: 'invalid_status', detail: `status="${status}"` },
      `Unknown status: "${status}".`,
    )
  }

  // Summary: <summary>...</summary>
  const summaryMatch = body.match(/<summary>([\s\S]*?)<\/summary>/)
  const summary = summaryMatch ? summaryMatch[1]?.trim() ?? '' : ''

  // Payload: <payload>...</payload> — JSON-parse the body. We also
  // tolerate fenced ```json blocks inside <payload>.
  const payloadMatch = body.match(/<payload>([\s\S]*?)<\/payload>/)
  if (!payloadMatch || !payloadMatch[1]) {
    throw new EnvelopeParseError(
      { code: 'missing_payload' },
      'Missing or empty <payload> tag.',
    )
  }
  const payloadText = stripCodeFences(payloadMatch[1].trim()).trim()
  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch (e) {
    throw new EnvelopeParseError(
      {
        code: 'payload_not_json',
        detail: e instanceof Error ? e.message : String(e),
      },
      `<payload> is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  return { status, summary, payload }
}

/**
 * Strip leading / trailing markdown code fences (``` ... ```), if
 * the fenced block IS the entire content. Used both at the top level
 * and inside <payload>.
 */
function stripCodeFences(s: string): string {
  const trimmed = s.trim()
  const m = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n```$/)
  if (m && m[1] !== undefined) return m[1]
  return s
}
