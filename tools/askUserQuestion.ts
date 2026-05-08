// ask_user_question tool — Translator-only. Pauses the pipeline to
// surface a multiple-choice question to the user via UI.
//
// V0.1 stub: throws ToolError "permission_denied" because the UI
// surface for receiving user responses isn't wired yet (Layer H).
// The tool's schema is fully defined here so the role harness and
// Translator's prompt template can validate against it; the actual
// runtime path will be filled in when the UI lands.

import { z } from 'zod'
import { buildTool, ToolError } from './ToolDef.js'

export const AskUserQuestionInputSchema = z.object({
  question: z.string().min(1).max(500),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(100),
        description: z.string().optional(),
      }),
    )
    .min(2)
    .max(6),
  allow_other: z.boolean().default(true),
  recommended_index: z.number().int().nonnegative().optional(),
})

export const AskUserQuestionOutputSchema = z.object({
  selected_index: z.number().int().min(-1),
  custom_text: z.string().optional(),
})

export const askUserQuestionTool = buildTool({
  name: 'ask_user_question',
  description:
    'Pause the pipeline and ask the user a multiple-choice clarifying question. Use sparingly — only when guessing would produce wildly different downstream specs. Translator role only. Pipeline resumes once the user answers.',
  inputSchema: AskUserQuestionInputSchema,
  outputSchema: AskUserQuestionOutputSchema,
  allowedRoles: ['translator'],

  async call(_input, _ctx) {
    throw new ToolError(
      'permission_denied',
      'ask_user_question',
      'ask_user_question is not wired to a UI yet (V0.1). Translator should proceed with default_assumption from the ambiguity field instead. Will be implemented in Layer H.',
      false,
    )
  },
})
