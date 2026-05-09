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

// Friendly action labels used in the timeline + chat-bubble verdict
// labels. Internal RoleType IDs unchanged in the orchestrator; this
// is the display layer.
export const ROLE_LABEL: Record<RoleType, string> = {
  translator: 'Understanding your idea',
  designer: 'Sketching the layout',
  architect: 'Planning the structure',
  coder: 'Writing your app',
  adversary: 'Double-checking',
  long_term_critic: 'Reviewing',
  test_runner: 'Testing',
  communicator: 'Wrapping up',
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
