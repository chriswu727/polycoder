// Custom geometric glyphs for polycoder. Ported verbatim from the
// V0.2 design package (claude.ai/design). Each icon is built from
// SVG primitives — squares, circles, lines — with currentColor as
// the stroke, so they tint via parent `color`.
//
// Design intent: distinct from the lucide-react default set. Each
// of the 8 roles gets a bespoke glyph (ROLE_ICONS) so the role
// avatars in the disagreement card and progress timeline are
// visually identifiable.

import { useId } from 'react'
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

// Brand mark — V3 cosmic octahedron / crystal. Internal facets +
// specular highlight + radial gradient body. Reads at 16px,
// majestic at 64px. The .pc-mark-halo class on the wrapper adds a
// slow-rotating accent halo (suppressed by prefers-reduced-motion).
//
// Uses React.useId() so multiple Mark instances on a page get
// unique gradient IDs (otherwise they'd cross-talk).
export const Mark: FC<IconProps & { animated?: boolean | undefined }> = ({
  size = 24,
  color,
  animated = true,
}) => {
  const rawId = useId()
  const id = rawId.replace(/[^a-z0-9]/gi, '')
  return (
    <span
      className={animated ? 'pc-mark-halo' : ''}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        color: color ?? 'currentColor',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        style={{ position: 'relative', zIndex: 1 }}
      >
        <defs>
          <radialGradient id={`mc-${id}`} cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="oklch(0.95 0.10 220)" stopOpacity={0.95} />
            <stop offset="50%" stopColor="oklch(0.68 0.18 250)" stopOpacity={0.85} />
            <stop offset="100%" stopColor="oklch(0.42 0.18 285)" stopOpacity={0.95} />
          </radialGradient>
          <linearGradient id={`me-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="oklch(0.92 0.14 200)" stopOpacity={0.95} />
            <stop offset="100%" stopColor="oklch(0.62 0.22 290)" stopOpacity={0.95} />
          </linearGradient>
        </defs>
        {/* Outer crystal silhouette — diamond / octahedron */}
        <path
          d="M16 3 L28 16 L16 29 L4 16 Z"
          fill={`url(#mc-${id})`}
          stroke={`url(#me-${id})`}
          strokeWidth={1.2}
          opacity={0.92}
        />
        {/* Internal facets — triangles for crystalline depth */}
        <path d="M16 3 L16 29" stroke="oklch(0.95 0.08 220 / 0.4)" strokeWidth={0.8} />
        <path d="M4 16 L28 16" stroke="oklch(0.95 0.08 220 / 0.4)" strokeWidth={0.8} />
        <path d="M16 3 L4 16 L16 16 Z" fill="oklch(0.95 0.10 215 / 0.18)" />
        <path d="M16 3 L28 16 L16 16 Z" fill="oklch(0.42 0.18 285 / 0.40)" />
        <path d="M16 16 L4 16 L16 29 Z" fill="oklch(0.42 0.18 285 / 0.30)" />
        <path d="M16 16 L28 16 L16 29 Z" fill="oklch(0.95 0.10 215 / 0.10)" />
        {/* Specular highlight */}
        <path
          d="M16 5.5 L11 13"
          stroke="oklch(0.99 0.02 215)"
          strokeWidth={0.9}
          opacity={0.65}
          strokeLinecap="round"
        />
        {/* Core nucleus */}
        <circle cx={16} cy={16} r={2.2} fill="oklch(0.96 0.12 215)" opacity={0.95} />
        <circle cx={16} cy={16} r={1.0} fill="white" />
      </svg>
    </span>
  )
}

// 8-bead chorus identity strip. Each bead = one of the 8 roles in
// its hue. Used in InProgressChat (above the user prompt) and the
// composer header to make "your team" visible. `pulse=true` makes
// each bead breathe (suppressed by prefers-reduced-motion).
const CHORUS_HUES = [220, 280, 175, 30, 0, 200, 145, 50]
export const Chorus: FC<{ pulse?: boolean | undefined; size?: number | undefined }> = ({
  pulse = false,
  size = 6,
}) => (
  <span className="pc-chorus" data-pulse={pulse ? 'true' : 'false'}>
    {CHORUS_HUES.map((hue, i) => (
      <span
        key={i}
        style={{
          width: size,
          height: size,
          background: `oklch(0.78 0.16 ${hue})`,
          color: `oklch(0.78 0.16 ${hue})`,
        }}
      />
    ))}
  </span>
)

// Verdict planet — V3 spherical illusion. Replaces the V2 flat
// VerdictOrb with a Genshin-grade elemental orb: radial body
// gradient + atmospheric ring + surface texture + specular
// highlight + a verdict-specific symbol etched on the surface.
export type Verdict = 'green' | 'yellow' | 'red'
export const VerdictPlanet: FC<{ verdict: Verdict; size?: number | undefined }> = ({
  verdict,
  size = 56,
}) => {
  const rawId = useId()
  const id = rawId.replace(/[^a-z0-9]/gi, '')
  const palette =
    verdict === 'green'
      ? {
          core: 'oklch(0.92 0.16 145)',
          mid: 'oklch(0.62 0.18 150)',
          deep: 'oklch(0.30 0.13 155)',
          atm: 'oklch(0.78 0.18 145)',
          tex: 'oklch(0.40 0.13 150)',
        }
      : verdict === 'yellow'
        ? {
            core: 'oklch(0.96 0.14 90)',
            mid: 'oklch(0.78 0.18 70)',
            deep: 'oklch(0.42 0.16 55)',
            atm: 'oklch(0.85 0.18 75)',
            tex: 'oklch(0.55 0.18 60)',
          }
        : {
            core: 'oklch(0.96 0.14 60)',
            mid: 'oklch(0.72 0.22 35)',
            deep: 'oklch(0.32 0.18 25)',
            atm: 'oklch(0.78 0.22 30)',
            tex: 'oklch(0.50 0.22 30)',
          }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <defs>
        <radialGradient id={`p-body-${id}`} cx="35%" cy="32%" r="72%">
          <stop offset="0%" stopColor={palette.core} stopOpacity={1} />
          <stop offset="35%" stopColor={palette.mid} stopOpacity={1} />
          <stop offset="100%" stopColor={palette.deep} stopOpacity={1} />
        </radialGradient>
        <radialGradient id={`p-atm-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="65%" stopColor={palette.atm} stopOpacity={0} />
          <stop offset="80%" stopColor={palette.atm} stopOpacity={0.5} />
          <stop offset="100%" stopColor={palette.atm} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`p-spec-${id}`} cx="32%" cy="28%" r="22%">
          <stop offset="0%" stopColor="white" stopOpacity={0.85} />
          <stop offset="100%" stopColor="white" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`p-tex-${id}`} cx="60%" cy="65%" r="45%">
          <stop offset="0%" stopColor={palette.tex} stopOpacity={0.6} />
          <stop offset="100%" stopColor={palette.tex} stopOpacity={0} />
        </radialGradient>
        <clipPath id={`p-clip-${id}`}>
          <circle cx={32} cy={32} r={24} />
        </clipPath>
      </defs>
      <circle cx={32} cy={32} r={30} fill={`url(#p-atm-${id})`} />
      <circle cx={32} cy={32} r={24} fill={`url(#p-body-${id})`} />
      <g clipPath={`url(#p-clip-${id})`}>
        <ellipse cx={42} cy={42} rx={14} ry={9} fill={`url(#p-tex-${id})`} opacity={0.7} />
        <ellipse cx={22} cy={20} rx={9} ry={4} fill={palette.tex} opacity={0.18} />
        <ellipse cx={38} cy={24} rx={6} ry={2.5} fill={palette.tex} opacity={0.22} />
        {verdict === 'red' ? (
          <>
            <ellipse cx={28} cy={38} rx={5} ry={2.5} fill="oklch(0.96 0.14 60)" opacity={0.45} />
            <ellipse cx={40} cy={46} rx={4} ry={2} fill="oklch(0.96 0.14 60)" opacity={0.35} />
          </>
        ) : null}
      </g>
      <ellipse cx={24} cy={22} rx={9} ry={5} fill={`url(#p-spec-${id})`} />
      <circle cx={32} cy={32} r={24} fill="none" stroke="oklch(0 0 0 / 0.35)" strokeWidth={1.2} />
      <g opacity={0.9}>
        {verdict === 'green' ? (
          <path
            d="M22 32 L29 39 L42 24"
            stroke="white"
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: 'drop-shadow(0 0 4px oklch(0.95 0.18 145))' }}
          />
        ) : null}
        {verdict === 'yellow' ? (
          <g style={{ filter: 'drop-shadow(0 0 4px oklch(0.95 0.18 80))' }}>
            <path d="M32 19 L32 35" stroke="white" strokeWidth={3} strokeLinecap="round" />
            <circle cx={32} cy={42} r={2.2} fill="white" />
          </g>
        ) : null}
        {verdict === 'red' ? (
          <g style={{ filter: 'drop-shadow(0 0 4px oklch(0.95 0.18 30))' }}>
            <path d="M24 24 L40 40" stroke="white" strokeWidth={3} strokeLinecap="round" />
            <path d="M40 24 L24 40" stroke="white" strokeWidth={3} strokeLinecap="round" />
          </g>
        ) : null}
      </g>
    </svg>
  )
}

// Mission glyphs — line-art motifs for the sample-prompt cards on
// the idle screen. One per prompt category, slightly luminous in
// dark mode via currentColor.
export const MissionTodo: FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="3" width="3" height="3" rx="0.6" />
    <path d="M3 4.5 L4 5.3 L5 3.8" />
    <path d="M7.5 4.5 L13 4.5" />
    <rect x="2.5" y="8" width="3" height="3" rx="0.6" />
    <path d="M7.5 9.5 L13 9.5" />
    <rect x="2.5" y="13" width="3" height="0.5" rx="0.2" fill="currentColor" />
  </svg>
)
export const MissionLanding: FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
    <path d="M2 5.5 L14 5.5" />
    <circle cx="3.5" cy="4" r="0.4" fill="currentColor" />
    <path d="M4.5 7.5 L11.5 7.5 M4.5 9.5 L9.5 9.5" />
    <rect x="4.5" y="11" width="3" height="1.5" rx="0.4" />
  </svg>
)
export const MissionDashboard: FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 13 L14 13" />
    <path d="M2 2.5 L2 13" />
    <path d="M3.5 11 L3.5 8.5 M6 11 L6 5.5 M8.5 11 L8.5 7 M11 11 L11 4.5 M13.5 11 L13.5 6.5" />
  </svg>
)
export const MissionNotes: FC<IconProps> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.2" />
    <path d="M8 2.5 L8 13.5" />
    <path d="M3.5 5.5 L6.5 5.5 M3.5 8 L6 8 M9.5 5.5 L12.5 5.5 M9.5 8 L12 8 M9.5 10.5 L12.5 10.5" />
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

export const IconSun: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <circle cx={8} cy={8} r={3} {...STROKE} />
    <path
      d="M8 1.5 L8 3 M8 13 L8 14.5 M14.5 8 L13 8 M3 8 L1.5 8 M12.5 3.5 L11.4 4.6 M4.6 11.4 L3.5 12.5 M12.5 12.5 L11.4 11.4 M4.6 4.6 L3.5 3.5"
      {...STROKE}
    />
  </Glyph>
)

export const IconMoon: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M13 9.5 A5 5 0 0 1 6.5 3 A5.5 5.5 0 1 0 13 9.5 Z" {...STROKE} />
  </Glyph>
)

export const IconTrash: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M3 4.5 L13 4.5 M5.5 4.5 L5.5 3 L10.5 3 L10.5 4.5 M4.5 4.5 L5.5 13.5 L10.5 13.5 L11.5 4.5 M6.5 7 L6.5 11.5 M9.5 7 L9.5 11.5"
      {...STROKE}
    />
  </Glyph>
)

export const IconEdit: FC<IconProps> = ({ size }) => (
  <Glyph size={size}>
    <path d="M11 3 L13 5 L5 13 L2.5 13.5 L3 11 Z" {...STROKE} />
    <path d="M10.5 3.5 L12.5 5.5" {...STROKE} />
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
