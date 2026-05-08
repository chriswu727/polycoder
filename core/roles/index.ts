// Role definitions for the 8 polycoder roles. Each definition pairs:
//   * A human-readable role identity (matches docs/prompts/{01..08}-*.md)
//   * The output payload schema (validates the model's <payload> JSON)
//   * Default model recommendations (used by Settings UI presets)
//   * Output-budget anchors (token soft-targets the model is asked to honor)
//
// The static system prompt itself is loaded from the prompt markdown
// files at runtime by core/roleHarness/promptAssembly.ts — keeping
// prompt text in markdown rather than .ts makes it editable without
// recompiling and matches docs/prompts/ as the source of truth.

import type { ZodType } from 'zod'
import type { RoleType, ALL_ROLES as _ALL_ROLES } from '@core/types/role.js'
import type { ToolName } from '@tools/ToolDef.js'
import { DEFAULT_ROLE_ALLOWLISTS } from '@tools/registry.js'
import { PAYLOAD_SCHEMAS } from '@core/types/payloads/index.js'

export type RoleDefinition = {
  role: RoleType
  /** Path to the role's static-prefix markdown, relative to docs/prompts/. */
  prompt_filename: string
  /** Tools this role may invoke. */
  allowed_tools: ToolName[]
  /** Zod schema validating the role's <payload> JSON. */
  payload_schema: ZodType<unknown>
  /** Soft anchor (in tokens) for the model's payload output budget. */
  output_payload_budget_tokens: number
  /** Recommended model fingerprint per preset (informational; UI uses these). */
  default_model_recommendations: {
    budget: string
    china_pro: string
    mixed: string
  }
  /** Documented in the prompt's "When to use" section; mostly informational. */
  whenToUse: string
}

export const ROLE_DEFINITIONS: Record<RoleType, RoleDefinition> = {
  translator: {
    role: 'translator',
    prompt_filename: '01-translator.md',
    allowed_tools: DEFAULT_ROLE_ALLOWLISTS.translator,
    payload_schema: PAYLOAD_SCHEMAS.translator,
    output_payload_budget_tokens: 500,
    default_model_recommendations: {
      budget: 'deepseek-chat',
      china_pro: 'qwen-plus',
      mixed: 'deepseek-chat',
    },
    whenToUse:
      'First role. Translates the vibe coder\'s natural-language prompt into a structured spec.',
  },
  designer: {
    role: 'designer',
    prompt_filename: '02-designer.md',
    allowed_tools: DEFAULT_ROLE_ALLOWLISTS.designer,
    payload_schema: PAYLOAD_SCHEMAS.designer,
    output_payload_budget_tokens: 800,
    default_model_recommendations: {
      budget: 'glm-4-flash',
      china_pro: 'glm-4-plus',
      mixed: 'claude-sonnet-4-6-20251022',
    },
    whenToUse:
      'Translates the structured spec into a UI/UX plan (components, layout, design tokens).',
  },
  architect: {
    role: 'architect',
    prompt_filename: '03-architect.md',
    allowed_tools: DEFAULT_ROLE_ALLOWLISTS.architect,
    payload_schema: PAYLOAD_SCHEMAS.architect,
    output_payload_budget_tokens: 1000,
    default_model_recommendations: {
      budget: 'deepseek-chat',
      china_pro: 'qwen-max',
      mixed: 'claude-opus-4-7-20260101',
    },
    whenToUse:
      'Maintains project memory and pattern consistency. Synthesis-discipline-checked output.',
  },
  coder: {
    role: 'coder',
    prompt_filename: '04-coder.md',
    allowed_tools: DEFAULT_ROLE_ALLOWLISTS.coder,
    payload_schema: PAYLOAD_SCHEMAS.coder,
    output_payload_budget_tokens: 4000, // task-driven; no anchor
    default_model_recommendations: {
      budget: 'deepseek-coder',
      china_pro: 'qwen3-coder',
      mixed: 'claude-sonnet-4-6-20251022',
    },
    whenToUse: 'Writes production code following Architect\'s guidance.',
  },
  adversary: {
    role: 'adversary',
    prompt_filename: '05-adversary.md',
    allowed_tools: DEFAULT_ROLE_ALLOWLISTS.adversary,
    payload_schema: PAYLOAD_SCHEMAS.adversary,
    output_payload_budget_tokens: 700,
    default_model_recommendations: {
      budget: 'glm-4-plus',
      china_pro: 'qwen-max',
      mixed: 'claude-opus-4-7-20260101',
    },
    whenToUse:
      'Adversarial bug hunter. Must use a different model from Coder (ADR-011).',
  },
  long_term_critic: {
    role: 'long_term_critic',
    prompt_filename: '06-long-term-critic.md',
    allowed_tools: DEFAULT_ROLE_ALLOWLISTS.long_term_critic,
    payload_schema: PAYLOAD_SCHEMAS.long_term_critic,
    output_payload_budget_tokens: 700,
    default_model_recommendations: {
      budget: 'deepseek-chat',
      china_pro: 'qwen-max',
      mixed: 'claude-opus-4-7-20260101',
    },
    whenToUse:
      'Trajectory-focused critic. Watches tech debt, fragility, refactor opportunities.',
  },
  test_runner: {
    role: 'test_runner',
    prompt_filename: '07-test-runner.md',
    allowed_tools: DEFAULT_ROLE_ALLOWLISTS.test_runner,
    payload_schema: PAYLOAD_SCHEMAS.test_runner,
    output_payload_budget_tokens: 1500, // task-driven
    default_model_recommendations: {
      budget: 'deepseek-chat',
      china_pro: 'deepseek-chat',
      mixed: 'deepseek-chat',
    },
    whenToUse:
      'Writes + runs tests. Must use a different model from Coder (ADR-011).',
  },
  communicator: {
    role: 'communicator',
    prompt_filename: '08-communicator.md',
    allowed_tools: DEFAULT_ROLE_ALLOWLISTS.communicator,
    payload_schema: PAYLOAD_SCHEMAS.communicator,
    output_payload_budget_tokens: 600,
    default_model_recommendations: {
      budget: 'glm-4-flash',
      china_pro: 'glm-4-flash',
      mixed: 'claude-haiku-4-5-20251001',
    },
    whenToUse:
      'Final role; only one that produces user-facing prose. Surfaces disagreements.',
  },
}

export type RoleDefinitionsMap = typeof ROLE_DEFINITIONS

export function getRoleDefinition(role: RoleType): RoleDefinition {
  return ROLE_DEFINITIONS[role]
}
