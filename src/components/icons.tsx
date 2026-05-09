// Custom geometric glyphs for polycoder. Ported verbatim from the
// V0.2 design package (claude.ai/design). Each icon is built from
// SVG primitives — squares, circles, lines — with currentColor as
// the stroke, so they tint via parent `color`.
//
// Design intent: distinct from the lucide-react default set. Each
// of the 8 roles gets a bespoke glyph (ROLE_ICONS) so the role
// avatars in the disagreement card and progress timeline are
// visually identifiable.

import type { CSSProperties, FC, ReactNode } from 'react'
import type { RoleType } from '@core/types/role.js'

// Shared stroke attrs — spread into <path>, <rect>, <circle>, etc.
// Typed as a plain record so TS doesn't complain when we spread it
// across different SVG element types.
const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
}

type GlyphProps = {
  size?: number | undefined
  style?: CSSProperties | undefined
  children: ReactNode
}
const Glyph: FC<GlyphProps> = ({ size = 16, children, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    style={{ flex: '0 0 auto', display: 'block', ...(style ?? {}) }}
  >
    {children}
  </svg>
)

export type IconProps = {
  size?: number | undefined
  style?: CSSProperties | undefined
  color?: string | undefined
}

// Brand mark — three nested squares, suggesting "many roles, one output".
export const Mark: FC<IconProps> = ({ size = 22, color }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    style={{ display: 'block', color: color ?? 'currentColor' }}
  >
    <rect x="3" y="3" width="14" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth={1.6} opacity={0.35} />
    <rect x="5" y="5" width="14" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth={1.6} opacity={0.6} />
    <rect x="7" y="7" width="14" height="14" rx="2.5" fill="currentColor" stroke="currentColor" strokeWidth={1.6} />
    <circle cx={14} cy={14} r={2} fill="var(--bg, #fff)" />
  </svg>
)

export const IconChat: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <rect x="2.5" y="3" width="11" height="8" rx="1.5" {...STROKE} />
    <path d="M5 11 L5 13 L7.5 11" {...STROKE} />
  </Glyph>
)

export const IconHistory: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <circle cx={8} cy={8} r={5.5} {...STROKE} />
    <path d="M8 5 L8 8 L10.5 9.5" {...STROKE} />
  </Glyph>
)

export const IconFolder: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M2.5 4 L6.5 4 L7.5 5.5 L13.5 5.5 L13.5 12 L2.5 12 Z" {...STROKE} />
  </Glyph>
)

export const IconKey: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <circle cx={5} cy={9} r={2.5} {...STROKE} />
    <path d="M7.2 8 L13 8 L13 10 M11 8 L11 10" {...STROKE} />
  </Glyph>
)

export const IconSettings: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <circle cx={8} cy={8} r={2} {...STROKE} />
    <path
      d="M8 1.5 L8 3.5 M8 12.5 L8 14.5 M14.5 8 L12.5 8 M3.5 8 L1.5 8 M12.6 3.4 L11.2 4.8 M4.8 11.2 L3.4 12.6 M12.6 12.6 L11.2 11.2 M4.8 4.8 L3.4 3.4"
      {...STROKE}
    />
  </Glyph>
)

export const IconPlus: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M8 3 L8 13 M3 8 L13 8" {...STROKE} />
  </Glyph>
)

export const IconCheck: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" {...STROKE} />
  </Glyph>
)

export const IconX: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M4 4 L12 12 M12 4 L4 12" {...STROKE} />
  </Glyph>
)

export const IconArrowUp: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M8 12.5 L8 3.5 M3.5 8 L8 3.5 L12.5 8" {...STROKE} />
  </Glyph>
)

export const IconArrowRight: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M3 8 L13 8 M9 4 L13 8 L9 12" {...STROKE} />
  </Glyph>
)

export const IconChevronDown: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M4 6.5 L8 10 L12 6.5" {...STROKE} />
  </Glyph>
)

export const IconChevronRight: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M6.5 4 L10 8 L6.5 12" {...STROKE} />
  </Glyph>
)

export const IconStop: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" stroke="currentColor" strokeWidth={1} />
  </Glyph>
)

export const IconRefresh: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M13 8 A5 5 0 1 1 11.5 4.5 L13 4 L13 6.5" {...STROKE} />
  </Glyph>
)

export const IconExternal: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M9 3 L13 3 L13 7 M13 3 L8 8 M12 8.5 L12 13 L3 13 L3 4 L7.5 4" {...STROKE} />
  </Glyph>
)

export const IconEye: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M1.5 8 C 3.5 4.5, 6 3, 8 3 C 10 3, 12.5 4.5, 14.5 8 C 12.5 11.5, 10 13, 8 13 C 6 13, 3.5 11.5, 1.5 8 Z" {...STROKE} />
    <circle cx={8} cy={8} r={2} {...STROKE} />
  </Glyph>
)

export const IconCopy: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <rect x="5" y="5" width="8" height="8" rx="1.5" {...STROKE} />
    <path d="M3 11 L3 3 L11 3" {...STROKE} />
  </Glyph>
)

export const IconLock: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" {...STROKE} />
    <path d="M5.5 7 L5.5 5 A2.5 2.5 0 0 1 10.5 5 L10.5 7" {...STROKE} />
  </Glyph>
)

export const IconSparkle: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M8 2 L8.8 6.2 L13 7 L8.8 7.8 L8 12 L7.2 7.8 L3 7 L7.2 6.2 Z" fill="currentColor" stroke="none" />
    <circle cx={13} cy={3} r={0.8} fill="currentColor" />
    <circle cx={3} cy={12.5} r={0.6} fill="currentColor" />
  </Glyph>
)

export const IconFile: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M3.5 2.5 L9 2.5 L12.5 6 L12.5 13.5 L3.5 13.5 Z" {...STROKE} />
    <path d="M9 2.5 L9 6 L12.5 6" {...STROKE} />
  </Glyph>
)

export const IconWarn: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M8 2 L14 13 L2 13 Z" {...STROKE} />
    <path d="M8 6.5 L8 9.5 M8 11 L8 11.5" {...STROKE} />
  </Glyph>
)

export const IconShield: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M8 2 L13 4 L13 8.5 C 13 11, 11 12.5, 8 14 C 5 12.5, 3 11, 3 8.5 L3 4 Z" {...STROKE} />
    <path d="M5.5 8 L7.5 10 L10.5 6.5" {...STROKE} />
  </Glyph>
)

export const IconCpu: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <rect x="4" y="4" width="8" height="8" rx="1" {...STROKE} />
    <rect x="6.5" y="6.5" width="3" height="3" {...STROKE} />
    <path
      d="M2.5 6.5 L4 6.5 M2.5 9.5 L4 9.5 M12 6.5 L13.5 6.5 M12 9.5 L13.5 9.5 M6.5 2.5 L6.5 4 M9.5 2.5 L9.5 4 M6.5 12 L6.5 13.5 M9.5 12 L9.5 13.5"
      {...STROKE}
    />
  </Glyph>
)

export const IconBeaker: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M6 2.5 L10 2.5 M7 2.5 L7 7 L3.5 12 A1.5 1.5 0 0 0 4.7 13.5 L11.3 13.5 A1.5 1.5 0 0 0 12.5 12 L9 7 L9 2.5" {...STROKE} />
  </Glyph>
)

export const IconBranch: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <circle cx={4} cy={3.5} r={1.5} {...STROKE} />
    <circle cx={4} cy={12.5} r={1.5} {...STROKE} />
    <circle cx={12} cy={6.5} r={1.5} {...STROKE} />
    <path d="M4 5 L4 11 M4 6 C 4 8.5, 6 9, 8 9 C 10 9, 10.5 8, 10.5 6.5" {...STROKE} />
  </Glyph>
)

export const IconLayout: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" {...STROKE} />
    <path d="M2.5 6 L13.5 6 M6.5 6 L6.5 13.5" {...STROKE} />
  </Glyph>
)

export const IconChat2: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M2.5 4 L13.5 4 L13.5 10 L8 10 L5 12.5 L5 10 L2.5 10 Z" {...STROKE} />
  </Glyph>
)

export const IconPen: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M3 13 L3 11 L10.5 3.5 L12.5 5.5 L5 13 Z" {...STROKE} />
  </Glyph>
)

export const IconStethoscope: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M4 2.5 L4 7 A2.5 2.5 0 0 0 9 7 L9 2.5" {...STROKE} />
    <path d="M6.5 9.5 L6.5 11 A2.5 2.5 0 0 0 11.5 11" {...STROKE} />
    <circle cx={11.5} cy={11} r={1} {...STROKE} />
  </Glyph>
)

export const IconMegaphone: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M3 6 L3 10 L5 10 L11 13 L11 3 L5 6 Z" {...STROKE} />
    <path d="M11.5 6.5 C 13 7, 13 9, 11.5 9.5" {...STROKE} />
  </Glyph>
)

// Per-role glyph map. Keys are RoleType values from
// @core/types/role.js, so consumers can do ROLE_ICONS[role].
export const ROLE_ICONS: Record<RoleType, FC<IconProps>> = {
  translator: IconChat2,
  designer: IconLayout,
  architect: IconBranch,
  coder: IconPen,
  adversary: IconShield,
  long_term_critic: IconStethoscope,
  test_runner: IconBeaker,
  communicator: IconMegaphone,
}
