// invokeRole — single-role orchestration with re-prompt logic.
// Per docs/specs/orchestrator.md §3 + §6.

import type { ModelProvider } from '@providers/ModelProvider.js'
import { ProviderError } from '@providers/errors.js'
import type { ToolContext } from '@tools/ToolDef.js'
import type { RoleType, RoleOutputEnvelope } from '@core/types/role.js'
import { ROLE_DEFINITIONS } from '@core/roles/index.js'
import { runWithTools, ToolLoopBudgetExceeded } from './runWithTools.js'
import { parseRoleOutput, EnvelopeParseError } from './envelopeParser.js'
import { toolsForRole } from '@tools/registry.js'
import {
  detectSynthesisDiscipline,
  synthesisDisciplineRePrompt,
} from '@core/orchestrator/synthesisDiscipline.js'
import { assembleSystemPrompt, type DynamicPromptInputs } from './promptAssembly.js'
import { buildInputEnvelope, type BuildInputEnvelopeArgs } from './envelopeBuilder.js'

export const MAX_ROLE_ATTEMPTS = 3
export const MAX_TOOL_CALLS_PER_ROLE = 20

export type InvokeRoleArgs = {
  role: RoleType
  provider: ModelProvider
  model: string
  ctx: ToolContext
  /** Inputs for promptAssembly. */
  promptInputs: DynamicPromptInputs
  /** Inputs for envelopeBuilder. */
  envelopeInputs: Omit<BuildInputEnvelopeArgs, 'role' | 'iteration'>
}

export type InvokeRoleSuccess = {
  status: 'success'
  envelope: RoleOutputEnvelope
  attempts: number
  toolCallsMade: number
  totalUsage: {
    input_tokens: number
    output_tokens: number
    cached_input_tokens: number
    estimated_cost_usd: number
  }
  synthesisDisciplineWarning?: string
}

export type InvokeRoleFailure = {
  status: 'failure'
  reason: InvokeRoleFailureReason
  attempts: number
  toolCallsMade: number
  totalUsage: {
    input_tokens: number
    output_tokens: number
    cached_input_tokens: number
    estimated_cost_usd: number
  }
  detail: string
}

export type InvokeRoleResult = InvokeRoleSuccess | InvokeRoleFailure

export type InvokeRoleFailureReason =
  | 'envelope_parse_exhausted'
  | 'payload_validation_exhausted'
  | 'tool_loop_budget_exceeded'
  | 'provider_error'
  | 'role_max_attempts_exceeded'
  | 'aborted'

/**
 * Invoke a role with retry logic. Returns success with the parsed
 * envelope, or failure with a structured reason.
 */
export async function invokeRole(args: InvokeRoleArgs): Promise<InvokeRoleResult> {
  const { role, provider, model, ctx, promptInputs, envelopeInputs } = args
  const def = ROLE_DEFINITIONS[role]
  const tools = toolsForRole(role)

  const systemPrompt = assembleSystemPrompt(role, promptInputs)
  let userMessage = buildInputEnvelope({
    role,
    iteration: promptInputs.iteration_number,
    ...envelopeInputs,
  })

  const aggregateUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    estimated_cost_usd: 0,
  }
  let totalToolCalls = 0
  let synthesisDisciplineWarning: string | undefined

  for (let attempt = 1; attempt <= MAX_ROLE_ATTEMPTS; attempt++) {
    if (ctx.abort_signal.aborted) {
      return {
        status: 'failure',
        reason: 'aborted',
        attempts: attempt - 1,
        toolCallsMade: totalToolCalls,
        totalUsage: aggregateUsage,
        detail: 'Aborted by orchestrator before attempt.',
      }
    }

    let runResult
    try {
      runResult = await runWithTools({
        provider,
        model,
        systemPrompt,
        initialUserMessage: userMessage,
        tools,
        ctx,
        maxToolCalls: MAX_TOOL_CALLS_PER_ROLE,
      })
    } catch (e) {
      if (e instanceof ToolLoopBudgetExceeded) {
        return {
          status: 'failure',
          reason: 'tool_loop_budget_exceeded',
          attempts: attempt,
          toolCallsMade: e.toolCallsMade,
          totalUsage: aggregateUsage,
          detail: e.message,
        }
      }
      if (e instanceof ProviderError) {
        if (!e.retryable || attempt >= MAX_ROLE_ATTEMPTS) {
          return {
            status: 'failure',
            reason: 'provider_error',
            attempts: attempt,
            toolCallsMade: totalToolCalls,
            totalUsage: aggregateUsage,
            detail: `${e.code}: ${e.message}`,
          }
        }
        // Retry with exponential backoff.
        await sleep(retryDelayMs(attempt, e))
        continue
      }
      // Unknown error — surface and stop.
      return {
        status: 'failure',
        reason: 'provider_error',
        attempts: attempt,
        toolCallsMade: totalToolCalls,
        totalUsage: aggregateUsage,
        detail: e instanceof Error ? e.message : String(e),
      }
    }

    totalToolCalls += runResult.toolCallsMade
    addUsage(aggregateUsage, runResult.totalUsage)

    // Parse the envelope.
    let parsed
    try {
      parsed = parseRoleOutput(runResult.finalText)
    } catch (e) {
      if (e instanceof EnvelopeParseError && attempt < MAX_ROLE_ATTEMPTS) {
        userMessage = buildEnvelopeRePrompt(e, runResult.finalText)
        continue
      }
      if (e instanceof EnvelopeParseError) {
        return {
          status: 'failure',
          reason: 'envelope_parse_exhausted',
          attempts: attempt,
          toolCallsMade: totalToolCalls,
          totalUsage: aggregateUsage,
          detail: `${e.reason.code}: ${e.message}`,
        }
      }
      return {
        status: 'failure',
        reason: 'envelope_parse_exhausted',
        attempts: attempt,
        toolCallsMade: totalToolCalls,
        totalUsage: aggregateUsage,
        detail: e instanceof Error ? e.message : String(e),
      }
    }

    // Validate the payload against the per-role Zod schema.
    const payloadResult = def.payload_schema.safeParse(parsed.payload)
    if (!payloadResult.success) {
      if (attempt < MAX_ROLE_ATTEMPTS) {
        userMessage = buildPayloadRePrompt(payloadResult.error.issues, parsed.payload)
        continue
      }
      return {
        status: 'failure',
        reason: 'payload_validation_exhausted',
        attempts: attempt,
        toolCallsMade: totalToolCalls,
        totalUsage: aggregateUsage,
        detail: JSON.stringify(payloadResult.error.issues).slice(0, 1000),
      }
    }

    // Architect-only: synthesis-discipline check.
    if (role === 'architect') {
      const violations = detectSynthesisDiscipline(JSON.stringify(parsed.payload))
      if (violations.length > 0) {
        if (attempt < MAX_ROLE_ATTEMPTS) {
          userMessage = synthesisDisciplineRePrompt(violations)
          continue
        }
        // Exhausted retries: emit anyway with a warning.
        synthesisDisciplineWarning = `Synthesis-discipline violations remained after ${MAX_ROLE_ATTEMPTS} attempts: ${violations
          .map((v) => v.matched)
          .join('; ')
          .slice(0, 500)}`
      }
    }

    // Override model attribute with what we actually used (the LLM
    // sometimes sets it to a stale value).
    const finalEnvelope: RoleOutputEnvelope = {
      ...parsed,
      model,
    }

    return {
      status: 'success',
      envelope: finalEnvelope,
      attempts: attempt,
      toolCallsMade: totalToolCalls,
      totalUsage: aggregateUsage,
      ...(synthesisDisciplineWarning !== undefined
        ? { synthesisDisciplineWarning }
        : {}),
    }
  }

  // Loop fall-through (shouldn't happen with the structure above).
  return {
    status: 'failure',
    reason: 'role_max_attempts_exceeded',
    attempts: MAX_ROLE_ATTEMPTS,
    toolCallsMade: totalToolCalls,
    totalUsage: aggregateUsage,
    detail: 'Exhausted attempts without producing a valid envelope.',
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function buildEnvelopeRePrompt(e: EnvelopeParseError, _previousResponse: string): string {
  return [
    'Your previous response did not produce a valid <role-output> envelope.',
    `Parser reason: ${e.reason.code} — ${e.message}`,
    '',
    'Re-emit your response as a single <role-output> XML envelope with no content before or after.',
    'The envelope must include role, iteration, model attributes plus <status>, <summary>, <payload>{...}</payload>.',
  ].join('\n')
}

function buildPayloadRePrompt(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
  _previousPayload: unknown,
): string {
  const lines = ['Your <payload> JSON does not match the required schema. Validation errors:']
  for (const issue of issues.slice(0, 8)) {
    const pathParts = issue.path.map((p) => String(p))
    const path = pathParts.length > 0 ? pathParts.join('.') : '(root)'
    lines.push(`  - ${path}: ${issue.message}`)
  }
  if (issues.length > 8) lines.push(`  ... and ${issues.length - 8} more.`)
  lines.push('')
  lines.push('Re-emit the entire <role-output> envelope with a corrected payload.')
  return lines.join('\n')
}

function retryDelayMs(attempt: number, err: ProviderError): number {
  if (err.retry_after_ms !== undefined && err.retry_after_ms > 0) {
    return Math.min(err.retry_after_ms, 5000)
  }
  return Math.min(200 * Math.pow(2, attempt - 1), 5000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function addUsage(
  total: InvokeRoleSuccess['totalUsage'],
  delta: InvokeRoleSuccess['totalUsage'],
): void {
  total.input_tokens += delta.input_tokens
  total.output_tokens += delta.output_tokens
  total.cached_input_tokens += delta.cached_input_tokens
  total.estimated_cost_usd += delta.estimated_cost_usd
}
