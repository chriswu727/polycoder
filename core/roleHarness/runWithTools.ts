// runWithTools — the inner loop for a single role invocation. Calls
// the provider, handles any tool calls the model issues, feeds the
// results back, and stops when the model emits a final text response
// (which the caller then parses as a <role-output> envelope).
//
// Per docs/specs/orchestrator.md §3.1.

import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ModelProvider,
  ToolSchema,
} from '@providers/ModelProvider.js'
import type { BuiltTool, ToolContext, ToolName } from '@tools/ToolDef.js'
import { ToolError } from '@tools/ToolDef.js'
import { toolToSchema } from '@tools/toJsonSchema.js'

/**
 * Per-tool-call observation hook. Fires AFTER each tool has run
 * (including failures). Lets callers stream live progress to the UI
 * — runQuickEdit pipes these into the PipelineEventBus as
 * `tool_call_progress` events so Quick Edit's running panel can
 * show "Reading src/auth.ts → Editing src/auth.ts → Done" in
 * real-time instead of going dark for 10s.
 */
export type ToolCallObservation = {
  tool_name: string
  /** A short human summary derived from the arguments (e.g. file
   *  path for read/write_file, command head for bash). */
  args_brief: string
  duration_ms: number
  ok: boolean
  /** Concise error description when ok is false. */
  error_brief?: string
}

export type RunWithToolsArgs = {
  provider: ModelProvider
  model: string
  systemPrompt: string
  initialUserMessage: string
  tools: BuiltTool<unknown, unknown>[]
  ctx: ToolContext
  /** Cap to prevent infinite tool-call loops. Default 20. */
  maxToolCalls?: number
  /** Optional observer for each tool call. */
  onToolCall?: (obs: ToolCallObservation) => void
  /**
   * Fires synchronously BEFORE the tool runs. Lets callers snapshot
   * pre-state — e.g. capture original file contents so a unified
   * diff can be computed after edit_file mutates them.
   */
  onBeforeToolCall?: (toolName: string, args: unknown) => void
}

export type RunWithToolsResult = {
  finalText: string
  toolCallsMade: number
  totalUsage: {
    input_tokens: number
    output_tokens: number
    cached_input_tokens: number
    estimated_cost_usd: number
  }
}

const DEFAULT_MAX_TOOL_CALLS = 20

export class ToolLoopBudgetExceeded extends Error {
  constructor(
    readonly toolCallsMade: number,
    readonly maxToolCalls: number,
  ) {
    super(`runWithTools exceeded tool-call budget (${toolCallsMade} > ${maxToolCalls})`)
    this.name = 'ToolLoopBudgetExceeded'
  }
}

export async function runWithTools(
  args: RunWithToolsArgs,
): Promise<RunWithToolsResult> {
  const { provider, model, ctx } = args
  const maxToolCalls = args.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS

  const toolByName = new Map<ToolName, BuiltTool<unknown, unknown>>()
  for (const t of args.tools) toolByName.set(t.name, t)

  const toolSchemas: ToolSchema[] = args.tools.map((t) => toolToSchema(t))

  const messages: ChatMessage[] = [
    { role: 'system', content: args.systemPrompt },
    { role: 'user', content: args.initialUserMessage },
  ]

  let toolCallsMade = 0
  const totalUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    estimated_cost_usd: 0,
  }

  while (true) {
    const request: ChatRequest = {
      model,
      messages,
      ...(toolSchemas.length > 0 ? { tools: toolSchemas, tool_choice: 'auto' as const } : {}),
    }

    const response: ChatResponse = await provider.chat(request, ctx.abort_signal)
    accumulateUsage(totalUsage, response)

    // Append the assistant's turn — even if it's a tool-use turn, we
    // need the tool_calls captured so the model sees its own prior
    // tool requests.
    if (response.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      })

      for (const tc of response.tool_calls) {
        toolCallsMade++
        if (toolCallsMade > maxToolCalls) {
          throw new ToolLoopBudgetExceeded(toolCallsMade, maxToolCalls)
        }

        args.onBeforeToolCall?.(tc.name, tc.arguments)
        const tcStartedAt = Date.now()
        const result = await executeToolCall(tc, toolByName, ctx)
        messages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: tc.id,
        })

        if (args.onToolCall) {
          const obs: ToolCallObservation = {
            tool_name: tc.name,
            args_brief: briefForArgs(tc.name, tc.arguments),
            duration_ms: Date.now() - tcStartedAt,
            ok: !result.content.startsWith('{"error":'),
          }
          if (!obs.ok) {
            obs.error_brief = extractErrorBrief(result.content)
          }
          args.onToolCall(obs)
        }
      }
      // Loop again — model gets to react to tool results.
      continue
    }

    // No tool calls → terminal response. Return the text.
    return {
      finalText: response.content,
      toolCallsMade,
      totalUsage,
    }
  }
}

function accumulateUsage(
  total: RunWithToolsResult['totalUsage'],
  response: ChatResponse,
): void {
  total.input_tokens += response.usage.input_tokens
  total.output_tokens += response.usage.output_tokens
  total.cached_input_tokens += response.usage.cached_input_tokens
  total.estimated_cost_usd += response.usage.estimated_cost_usd
}

async function executeToolCall(
  tc: ChatToolCall,
  toolByName: Map<ToolName, BuiltTool<unknown, unknown>>,
  ctx: ToolContext,
): Promise<{ content: string }> {
  const tool = toolByName.get(tc.name as ToolName)
  if (!tool) {
    return {
      content: serializeToolError({
        code: 'permission_denied',
        message: `Tool "${tc.name}" not in this role's allowlist.`,
      }),
    }
  }

  // Validate input via Zod.
  const inputResult = tool.inputSchema.safeParse(tc.arguments)
  if (!inputResult.success) {
    return {
      content: serializeToolError({
        code: 'invalid_input',
        message: `Schema validation failed: ${JSON.stringify(inputResult.error.issues).slice(0, 1000)}`,
      }),
    }
  }

  try {
    const output = await tool.call(inputResult.data, ctx)
    return { content: JSON.stringify(output) }
  } catch (e) {
    if (e instanceof ToolError) {
      return {
        content: serializeToolError({
          code: e.code,
          message: e.message,
        }),
      }
    }
    return {
      content: serializeToolError({
        code: 'unknown',
        message: e instanceof Error ? e.message : String(e),
      }),
    }
  }
}

function serializeToolError(err: { code: string; message: string }): string {
  return JSON.stringify({ error: err })
}

/**
 * Tiny per-tool argument summarizer. Used only for the ToolCall
 * observation surface; never for the message that actually goes back
 * to the model.
 */
function briefForArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  switch (toolName) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return typeof a.path === 'string' ? a.path : ''
    case 'bash': {
      const cmd = typeof a.command === 'string' ? a.command : ''
      return cmd.length > 60 ? cmd.slice(0, 60) + '…' : cmd
    }
    case 'run_test_suite':
      return typeof a.command === 'string' ? a.command : 'test suite'
    case 'read_history':
      return typeof a.iteration_id === 'string' ? a.iteration_id : ''
    case 'read_project_memory':
      return ''
    default: {
      const v = Object.values(a)[0]
      return typeof v === 'string' ? v.slice(0, 60) : ''
    }
  }
}

function extractErrorBrief(content: string): string {
  try {
    const parsed = JSON.parse(content) as { error?: { message?: string } }
    return parsed.error?.message?.slice(0, 120) ?? 'error'
  } catch {
    return 'error'
  }
}
