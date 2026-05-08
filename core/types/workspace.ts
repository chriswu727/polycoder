// Workspace, Secret, RoleAssignment, Preset.
// See SPEC.md §5 (data model) and docs/specs/providers.md §1-2.

import { z } from 'zod'
import { RoleTypeSchema, type RoleType } from './role.js'

// ─── ProviderId ──────────────────────────────────────────────────────

export const ProviderIdSchema = z.enum([
  'deepseek',
  'qwen',
  'glm',
  'openai-compat',
  'anthropic',
])

export type ProviderId = z.infer<typeof ProviderIdSchema>

// ─── Secret ──────────────────────────────────────────────────────────
// On-disk shape (the api_key is stored separately in OS keychain;
// this row carries metadata only — see Layer D for the keystore).

export const SecretMetaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  provider: ProviderIdSchema,
  base_url: z.string().url().nullable(),
  available_models: z.array(z.string()),
  last_tested_at: z.number().int().nullable(),
  created_at: z.number().int(),
})

export type SecretMeta = z.infer<typeof SecretMetaSchema>

/**
 * Hydrated form: SecretMeta + api_key fetched from keystore.
 * Never persisted to SQLite. Constructed on-demand for provider calls.
 */
export const HydratedSecretSchema = SecretMetaSchema.extend({
  api_key: z.string().min(1),
})

export type HydratedSecret = z.infer<typeof HydratedSecretSchema>

// ─── RoleAssignment ──────────────────────────────────────────────────

export const RoleAssignmentSchema = z.object({
  role: RoleTypeSchema,
  secret_id: z.string().uuid().nullable(),
  model_id: z.string().nullable(),
  fallback_secret_id: z.string().uuid().nullable(),
  fallback_model_id: z.string().nullable(),
  custom_prompt_override: z.string().nullable(),
})

export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>

// ─── Preset ──────────────────────────────────────────────────────────

export const PresetIdSchema = z.enum([
  'budget',
  'china_pro',
  'mixed',
  'custom',
])

export type PresetId = z.infer<typeof PresetIdSchema>

// ─── Workspace ───────────────────────────────────────────────────────

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  workspace_root: z.string().min(1),
  ui_lang: z.enum(['zh-CN', 'en']).default('zh-CN'),
  preset: PresetIdSchema.default('custom'),
  created_at: z.number().int(),
  updated_at: z.number().int(),
})

export type Workspace = z.infer<typeof WorkspaceSchema>

/** Hydrated workspace: the row plus its secrets and role assignments. */
export type HydratedWorkspace = Workspace & {
  secrets: SecretMeta[]
  role_assignments: Record<RoleType, RoleAssignment>
}
