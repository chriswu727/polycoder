// envelopeBuilder — constructs the `<role-input>` XML envelope that
// the role harness sends as a user message. See ADR-010.
//
// Format (matches the user-message shape documented in each role's
// prompt §5):
//
//   <role-input role="..." iteration="N">
//     <project_memory>{ ... JSON ... }</project_memory>
//     <prior_outputs>...</prior_outputs>
//     <task>...</task>
//   </role-input>
//
// The orchestrator picks which `<prior_outputs>` to include per role
// (e.g. Coder receives Architect's output; Communicator receives all).

import type { RoleType, RoleOutputEnvelope } from '@core/types/role.js'
import type { ProjectMemory } from '@core/types/projectMemory.js'

export type BuildInputEnvelopeArgs = {
  role: RoleType
  iteration: number
  project_memory: ProjectMemory | null
  prior_outputs?: Partial<Record<RoleType, RoleOutputEnvelope>>
  /**
   * Free-form payload describing the immediate task. For the Translator,
   * this is the user's raw prompt. For downstream roles, the orchestrator
   * may include additional context (codebase snapshot, etc.).
   */
  task: Record<string, unknown> | string
  iteration_history?: Array<Record<string, unknown>>
  ui_lang?: 'zh-CN' | 'en'
}

export function buildInputEnvelope(args: BuildInputEnvelopeArgs): string {
  const { role, iteration } = args
  const lines: string[] = [`<role-input role="${role}" iteration="${iteration}">`]

  if (args.project_memory) {
    lines.push('  <project_memory>')
    lines.push(`    ${JSON.stringify(args.project_memory)}`)
    lines.push('  </project_memory>')
  } else {
    lines.push('  <project_memory>null</project_memory>')
  }

  if (args.prior_outputs && Object.keys(args.prior_outputs).length > 0) {
    lines.push('  <prior_outputs>')
    // Stable role order for reproducibility.
    const ordered: RoleType[] = [
      'translator',
      'designer',
      'architect',
      'coder',
      'adversary',
      'long_term_critic',
      'test_runner',
    ]
    for (const r of ordered) {
      const env = args.prior_outputs[r]
      if (!env) continue
      lines.push(`    <${r}_output>`)
      lines.push(`      ${JSON.stringify(env)}`)
      lines.push(`    </${r}_output>`)
    }
    lines.push('  </prior_outputs>')
  }

  if (args.iteration_history && args.iteration_history.length > 0) {
    lines.push('  <iteration_history>')
    lines.push(`    ${JSON.stringify(args.iteration_history)}`)
    lines.push('  </iteration_history>')
  }

  if (args.ui_lang) {
    lines.push(`  <ui_lang>${args.ui_lang}</ui_lang>`)
  }

  lines.push('  <task>')
  if (typeof args.task === 'string') {
    lines.push(`    ${escapeForXmlBody(args.task)}`)
  } else {
    lines.push(`    ${JSON.stringify(args.task)}`)
  }
  lines.push('  </task>')

  lines.push('</role-input>')

  return lines.join('\n')
}

/**
 * Conservative escape for free-form text inside an XML body element.
 * We only escape the structural chars; LLMs handle the rest fine.
 */
function escapeForXmlBody(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
