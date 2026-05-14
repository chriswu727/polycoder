// Producer (项目经理) — conversational orchestrator agent.
//
// The Producer sits ON TOP of the 8-role pipeline. It is the user's
// only conversational surface; the user never directly talks to
// Translator/Designer/Architect/Coder/etc. The Producer:
//
//   1. Receives natural-language messages from the user
//   2. Decides whether to ask a clarifying question, or dispatch
//      the team via tools (`run_full_pipeline`, `run_quick_edit`),
//      or just respond conversationally
//   3. Reports team output back in plain Chinese, surfacing
//      disagreements honestly without smoothing them over
//
// Unlike the 8 roles, the Producer is NOT in the RoleType enum and
// does NOT produce a `<role-output>` envelope — its output is
// natural-language chat. Each user message → one Producer turn via
// `runProducerTurn` below.

import type Database from 'better-sqlite3'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ModelProvider, ChatMessage, ChatToolCall } from '@providers/ModelProvider.js'
import type { KeyStore } from '../../electron/secrets/keystore.js'
import type { Workspace } from '@core/types/workspace.js'
import type { ToolContext } from '@tools/ToolDef.js'
import {
  runWithTools,
  ToolLoopBudgetExceeded,
} from '@core/roleHarness/runWithTools.js'
import { runIteration, type ProviderFactory } from './../orchestrator/runIteration.js'
import { runQuickEdit } from './../orchestrator/runQuickEdit.js'
import { PipelineEventBus } from './../orchestrator/events.js'
import { POLYCODER_PROMPT_BOUNDARY } from '@providers/prepareSystemPrompt.js'
import { listWorkspaceFiles, readWorkspaceFile } from '../../electron/workspaceFiles.js'
import { buildTool, type BuiltTool, type ToolName } from '@tools/ToolDef.js'
import { z } from 'zod'

// Producer's tools live OUTSIDE the global ToolName registry — they
// dispatch back into the orchestrator and are local to this agent.
// `buildTool`'s `name` field is typed against ToolName for global
// tools; we cast here in one place so the rest of the agent code
// reads as plain TypeScript.
function localProducerTool<I, O>(
  args: Omit<Parameters<typeof buildTool<I, O>>[0], 'name'> & { name: string },
): BuiltTool<I, O> {
  return buildTool({
    ...args,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    name: args.name as ToolName,
  })
}

// ─── Prompt loading ─────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PROMPTS_DIR_CANDIDATES = [
  resolve(__dirname, '..', '..', 'docs', 'prompts'),
  resolve(__dirname, '..', '..', '..', 'docs', 'prompts'),
  resolve(__dirname, '..', '..', '..', '..', 'docs', 'prompts'),
]

function findPromptsDir(): string {
  for (const candidate of PROMPTS_DIR_CANDIDATES) {
    if (existsSync(resolve(candidate, '09-producer.md'))) return candidate
  }
  throw new Error('Cannot locate docs/prompts/ for Producer agent')
}

let _producerPromptCache: string | null = null
function loadProducerPrompt(): string {
  if (_producerPromptCache !== null) return _producerPromptCache
  const text = readFileSync(join(findPromptsDir(), '09-producer.md'), 'utf8')
  _producerPromptCache = text
  return text
}

function stripDocumentedDynamicSuffix(md: string): string {
  const idx = md.search(/^##\s+Dynamic suffix/m)
  return idx < 0 ? md : md.slice(0, idx).trimEnd()
}

function buildProducerSystemPrompt(
  workspace: Workspace,
  fileCount: number,
  turnCount: number,
  recentSummary: string | null,
): string {
  const staticPart = stripDocumentedDynamicSuffix(loadProducerPrompt())
  const dynamic = [
    '# 当前上下文',
    '',
    `工作目录: ${workspace.name}（已有 ${fileCount} 个文件）`,
    `当前会话已聊了 ${turnCount} 轮`,
    `最近一次 iteration: ${recentSummary ?? 'null（还没有跑过）'}`,
    '',
    '用户的新消息在下一条 user message 里。回应他。',
  ].join('\n')
  return [staticPart, '', POLYCODER_PROMPT_BOUNDARY, '', dynamic].join('\n')
}

// ─── Tools the Producer can call ────────────────────────────────────

const RunFullPipelineInputSchema = z.object({
  user_prompt: z.string().min(1).describe(
    "The user's concrete request in their own words. Pass through verbatim — the team will translate.",
  ),
})

const RunQuickEditInputSchema = z.object({
  instruction: z.string().min(1).describe(
    "One-line description of the small change. e.g. '把添加按钮的颜色改成蓝色'.",
  ),
})

const ListFilesInputSchema = z.object({})

const ReadFileInputSchema = z.object({
  path: z.string().min(1).describe('Workspace-relative file path.'),
})

const PipelineOutputSchema = z.object({
  status: z.enum(['completed', 'failed', 'aborted']),
  iteration_id: z.string().optional(),
  traffic_light: z.enum(['green', 'yellow', 'red']).nullable().optional(),
  files_changed: z.array(z.string()).default([]),
  total_cost_usd: z.number().default(0),
  duration_seconds: z.number().default(0),
  user_facing_text: z.string().optional(),
  what_to_do_next: z
    .array(z.object({ suggestion: z.string(), priority: z.string() }))
    .optional(),
  disagreement_cards: z.array(z.unknown()).optional(),
  error: z.string().optional(),
})

const QuickEditOutputSchema = z.object({
  status: z.enum(['completed', 'failed', 'aborted']),
  iteration_id: z.string().optional(),
  files_changed: z.array(z.string()).default([]),
  total_cost_usd: z.number().default(0),
  duration_seconds: z.number().default(0),
  summary: z.string().optional(),
  error: z.string().optional(),
})

const ListFilesOutputSchema = z.object({
  files: z.array(z.object({ path: z.string(), size: z.number() })),
})

const ReadFileOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  size: z.number().optional(),
  content: z.string().optional(),
  truncated: z.boolean().optional(),
  error: z.string().optional(),
})

export type ProducerToolName =
  | 'run_full_pipeline'
  | 'run_quick_edit'
  | 'list_workspace_files'
  | 'read_workspace_file'

// ─── Public API ─────────────────────────────────────────────────────

export type RunProducerTurnArgs = {
  db: Database.Database
  keystore: KeyStore
  workspace: Workspace
  /** Provider + model for the Producer agent itself. Should be a
   *  cheap, fast, Chinese-fluent model (deepseek-chat / glm-4-flash).
   *  This is NOT the same as the per-role models the pipeline uses. */
  producerProvider: ModelProvider
  producerModel: string
  /**
   * Provider factory for the underlying 8-role pipeline (i.e. when
   * Producer invokes run_full_pipeline / run_quick_edit). Reuses the
   * existing per-role assignment logic.
   */
  providerFactoryForPipeline: ProviderFactory
  /** Coder's provider + model for Quick Edit (single-Coder fast path). */
  coderProvider: ModelProvider
  coderModel: string
  /** Prior conversation history with the Producer. Empty on first turn. */
  priorMessages: ChatMessage[]
  newUserMessage: string
  recentIterationSummary?: string | null
  abort_signal?: AbortSignal
  /**
   * Optional event bus. When the Producer dispatches a sub-pipeline
   * via run_full_pipeline, those pipeline events get forwarded here
   * so the renderer can show team activity live.
   */
  eventBus?: PipelineEventBus
}

export type ProducerTurnResult = {
  /** Producer's final assistant text response. */
  assistantText: string
  /** Updated conversation history (including the new user message
   *  and the Producer's response). */
  messages: ChatMessage[]
  /** Tools the Producer invoked during this turn, in order. */
  toolInvocations: Array<{ name: ProducerToolName; brief: string; ok: boolean }>
  /** Iteration IDs created during this turn (full pipeline or quick
   *  edit), so the renderer can render them in history. */
  iterationsCreated: string[]
  totalUsage: {
    input_tokens: number
    output_tokens: number
    estimated_cost_usd: number
  }
}

/**
 * Run one Producer turn: feed the new user message into the
 * conversation, let the Producer decide what to do (ask, dispatch,
 * just respond), and return the updated conversation + any
 * iterations created.
 */
export async function runProducerTurn(
  args: RunProducerTurnArgs,
): Promise<ProducerTurnResult> {
  const fileCount = (() => {
    try {
      return listWorkspaceFiles(args.workspace.workspace_root).length
    } catch {
      return 0
    }
  })()
  const turnCount = args.priorMessages.filter((m) => m.role === 'user').length

  const systemPrompt = buildProducerSystemPrompt(
    args.workspace,
    fileCount,
    turnCount,
    args.recentIterationSummary ?? null,
  )

  // Compose the running message list: prior + new user message.
  const initialMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...args.priorMessages.filter((m) => m.role !== 'system'),
    { role: 'user', content: args.newUserMessage },
  ]

  const iterationsCreated: string[] = []
  const toolInvocations: ProducerTurnResult['toolInvocations'] = []

  // Build the tool implementations that close over `args`. These are
  // BuiltTool instances so they ride through runWithTools' existing
  // input-validation + output-serialization machinery.
  const runFullPipelineTool = localProducerTool({
    name: 'run_full_pipeline',
    description:
      'Dispatch the full 8-role team (Translator → Designer → Architect → Coder → Adversary || Long-term Critic || Test Runner → Communicator) on the given user prompt. Returns traffic_light + files_changed + cost. Use when the user wants to BUILD or majorly RESTRUCTURE.',
    inputSchema: RunFullPipelineInputSchema,
    outputSchema: PipelineOutputSchema,
    async call(input) {
      const t0 = Date.now()
      try {
        const result = await runIteration({
          db: args.db,
          keystore: args.keystore,
          workspace: args.workspace,
          user_prompt: input.user_prompt,
          providerFactory: args.providerFactoryForPipeline,
          ...(args.abort_signal !== undefined
            ? { abort_signal: args.abort_signal }
            : {}),
          ...(args.eventBus !== undefined ? { eventBus: args.eventBus } : {}),
        })
        if (result.status === 'completed') {
          iterationsCreated.push(result.iteration_id)
          const comm = result.role_outputs.communicator?.payload as
            | { user_facing_text?: string; what_to_do_next?: Array<{ suggestion: string; priority: string }>; disagreement_cards?: unknown[] }
            | undefined
          const out = {
            status: 'completed' as const,
            iteration_id: result.iteration_id,
            traffic_light: result.traffic_light,
            files_changed: result.files_changed,
            total_cost_usd: Number(result.total_cost_usd.toFixed(4)),
            duration_seconds: Math.round(result.duration_ms / 1000),
            ...(comm?.user_facing_text !== undefined
              ? { user_facing_text: comm.user_facing_text }
              : {}),
            ...(comm?.what_to_do_next !== undefined
              ? { what_to_do_next: comm.what_to_do_next }
              : {}),
            ...(comm?.disagreement_cards !== undefined
              ? { disagreement_cards: comm.disagreement_cards }
              : {}),
          }
          // eslint-disable-next-line no-console
          console.error(
            `[producer.run_full_pipeline] returned: status=completed iter=${result.iteration_id} traffic=${result.traffic_light} files=${result.files_changed.length} cost=$${out.total_cost_usd}`,
          )
          return out
        }
        const failReturn = {
          status: result.status,
          iteration_id: result.iteration_id,
          files_changed: [],
          total_cost_usd: Number(result.cost_so_far_usd.toFixed(4)),
          duration_seconds: Math.round((Date.now() - t0) / 1000),
          error: result.status === 'failed' ? result.error : result.reason,
        }
        // eslint-disable-next-line no-console
        console.error(
          `[producer.run_full_pipeline] returned: status=${failReturn.status} error=${failReturn.error?.slice(0, 200)}`,
        )
        return failReturn
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        // eslint-disable-next-line no-console
        console.error(`[producer.run_full_pipeline] THREW: ${errMsg}`)
        return {
          status: 'failed' as const,
          files_changed: [],
          total_cost_usd: 0,
          duration_seconds: Math.round((Date.now() - t0) / 1000),
          error: errMsg,
        }
      }
    },
  })

  const runQuickEditTool = localProducerTool({
    name: 'run_quick_edit',
    description:
      'Dispatch only the Coder for a SMALL change to an existing file (e.g. "change button color to blue"). Faster + cheaper than run_full_pipeline. Use for tweaks, not new features.',
    inputSchema: RunQuickEditInputSchema,
    outputSchema: QuickEditOutputSchema,
    async call(input) {
      const t0 = Date.now()
      try {
        const result = await runQuickEdit({
          db: args.db,
          keystore: args.keystore,
          workspace: args.workspace,
          instruction: input.instruction,
          provider: args.coderProvider,
          model: args.coderModel,
          ...(args.abort_signal !== undefined
            ? { abort_signal: args.abort_signal }
            : {}),
          ...(args.eventBus !== undefined ? { eventBus: args.eventBus } : {}),
        })
        if (result.status === 'completed') {
          iterationsCreated.push(result.iteration_id)
          return {
            status: 'completed' as const,
            iteration_id: result.iteration_id,
            files_changed: result.files_changed,
            total_cost_usd: Number(result.total_cost_usd.toFixed(4)),
            duration_seconds: Math.round(result.duration_ms / 1000),
            summary: result.summary,
          }
        }
        return {
          status: result.status,
          iteration_id: result.iteration_id,
          files_changed: result.files_changed,
          total_cost_usd: Number(result.total_cost_usd.toFixed(4)),
          duration_seconds: Math.round(result.duration_ms / 1000),
          error: result.detail,
        }
      } catch (e) {
        return {
          status: 'failed' as const,
          files_changed: [],
          total_cost_usd: 0,
          duration_seconds: Math.round((Date.now() - t0) / 1000),
          error: e instanceof Error ? e.message : String(e),
        }
      }
    },
  })

  const listFilesTool = localProducerTool({
    name: 'list_workspace_files',
    description:
      'List files in the workspace (capped, dot-files and node_modules excluded). Use to know what already exists before deciding what to build.',
    inputSchema: ListFilesInputSchema,
    outputSchema: ListFilesOutputSchema,
    call(_input) {
      try {
        const files = listWorkspaceFiles(args.workspace.workspace_root)
        return Promise.resolve({
          files: files.map((f) => ({ path: f.path, size: f.size })),
        })
      } catch {
        return Promise.resolve({ files: [] })
      }
    },
  })

  const readFileTool = localProducerTool({
    name: 'read_workspace_file',
    description:
      'Read a single file from the workspace. Use to check what is actually in a file before answering a user question about it.',
    inputSchema: ReadFileInputSchema,
    outputSchema: ReadFileOutputSchema,
    call(input) {
      const r = readWorkspaceFile(args.workspace.workspace_root, input.path)
      if (r.ok) {
        return Promise.resolve({
          ok: true,
          path: r.path,
          size: r.size,
          content: r.content,
          truncated: r.truncated,
        })
      }
      return Promise.resolve({ ok: false, error: r.error })
    },
  })

  const tools = [
    runFullPipelineTool,
    runQuickEditTool,
    listFilesTool,
    readFileTool,
  ] as unknown as Parameters<typeof runWithTools>[0]['tools']

  // Minimal ToolContext for the Producer's own tool calls. The
  // Producer's tools don't actually use most ToolContext fields
  // (they reach back to `args` via closures), but runWithTools
  // requires a ctx anyway.
  const ctx: ToolContext = {
    workspace_id: args.workspace.id,
    workspace_root: args.workspace.workspace_root,
    iteration_id: 'producer-session',
    role: 'communicator', // type-only; producer tools don't check role
    abort_signal: args.abort_signal ?? new AbortController().signal,
    emit_event: () => {},
    db: args.db,
    keystore: args.keystore,
    read_files_in_iteration: new Set<string>(),
    iteration_number: 0,
  }

  let finalText = ''
  let usage = {
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
  }

  try {
    const run = await runWithTools({
      provider: args.producerProvider,
      model: args.producerModel,
      systemPrompt,
      initialUserMessage: '', // ignored when initialMessages is set
      initialMessages,
      tools,
      ctx,
      // Producer needs headroom for the self-correction loop in
       // prompt §8 — up to 3 dispatches + occasional list/read calls
       // means we want ~8 to be comfortable.
       maxToolCalls: 10,
      onToolCall: (obs) => {
        toolInvocations.push({
          name: obs.tool_name as ProducerToolName,
          brief: obs.args_brief,
          ok: obs.ok,
        })
      },
    })
    finalText = run.finalText.trim() || '(no response)'
    usage = {
      input_tokens: run.totalUsage.input_tokens,
      output_tokens: run.totalUsage.output_tokens,
      estimated_cost_usd: run.totalUsage.estimated_cost_usd,
    }
    // Strip the prepended system message before returning history.
    return {
      assistantText: finalText,
      messages: run.messages.filter((m) => m.role !== 'system'),
      toolInvocations,
      iterationsCreated,
      totalUsage: usage,
    }
  } catch (e) {
    if (e instanceof ToolLoopBudgetExceeded) {
      // Producer hit max tool calls — return what we have with a
      // graceful note. Should be rare.
      return {
        assistantText:
          '(我尝试调度团队时进入了循环，先到这里。请重新告诉我你想要什么。)',
        messages: initialMessages.slice(1).concat([
          {
            role: 'assistant',
            content:
              '(我尝试调度团队时进入了循环，先到这里。请重新告诉我你想要什么。)',
          },
        ]),
        toolInvocations,
        iterationsCreated,
        totalUsage: usage,
      }
    }
    throw e
  }
}

// Re-export ChatToolCall to silence unused warning if any caller
// imports types from this module.
export type { ChatToolCall }
