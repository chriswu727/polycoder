// Per-role color palette + friendly labels. Used by:
//   - DisagreementCard (role avatars + voice ribbons)
//   - RolePipelineProgress (timeline avatars + connecting lines + pulse rings)
//   - any future surface that needs to identify a role visually
//
// Each role has a distinct quiet hue. Low-chroma intentionally — these
// are identity colors, not warning colors. The same palette flows
// through the disagreement card and the regular run timeline so the
// "team" feeling is consistent.

import type { RoleType } from '@core/types/role.js'

export const ROLE_HUE: Record<RoleType, number> = {
  translator: 220,
  designer: 280,
  architect: 175,
  coder: 30,
  adversary: 0,
  long_term_critic: 200,
  test_runner: 145,
  communicator: 50,
}

// Lowercase short labels used by the disagreement card stance rows.
export const ROLE_SHORT: Record<RoleType, string> = {
  translator: 'understanding',
  designer: 'sketching',
  architect: 'planning',
  coder: 'writing',
  adversary: 'double-checking',
  long_term_critic: 'reviewing',
  test_runner: 'testing',
  communicator: 'wrapping up',
}

// Friendly Chinese labels — the team's "human-readable" job titles.
// Internal RoleType IDs stay English in the orchestrator; this is the
// display layer the user sees. Each label is the team member's role,
// in a tone a non-coder middle-aged user would recognize.
export const ROLE_LABEL: Record<RoleType, string> = {
  translator: '需求翻译师',
  designer: '设计师',
  architect: '架构远见师',
  coder: '写码工程师',
  adversary: '挑刺专家',
  long_term_critic: '资深架构师',
  test_runner: '测试小组',
  communicator: '信息官',
}

// One-line role description, shown on hover in the meeting-room view.
// Plain Chinese, no English jargon.
export const ROLE_DESCRIPTION: Record<RoleType, string> = {
  translator: '听你说想做什么，把它翻成团队能用的清晰需求。',
  designer: '决定你的产品该长什么样、有什么交互。',
  architect: '决定代码用什么技术、文件怎么组织、整体结构。',
  coder: '团队里唯一真正动手写代码的人。',
  adversary: '挑刺。专门找 bug、边界 case、安全漏洞。',
  long_term_critic: '看长期——这次改动会不会让代码以后难维护。',
  test_runner: '写测试、跑测试、确认产品真能用。',
  communicator: '把团队做的事用大白话告诉你，包括坏消息。',
}

export function hueFor(role: string): number {
  return (ROLE_HUE as Record<string, number | undefined>)[role] ?? 220
}

export function shortFor(role: string): string {
  return (ROLE_SHORT as Record<string, string | undefined>)[role] ?? role
}

// V2 design palette: each role's identity color across light and dark.
// Used by RoleTimelineRow.
export function roleSwatches(hue: number): {
  base: string
  soft: string
  border: string
} {
  return {
    base: `oklch(0.60 0.105 ${hue})`,
    soft: `oklch(0.95 0.038 ${hue})`,
    border: `oklch(0.60 0.105 ${hue} / 0.45)`,
  }
}
