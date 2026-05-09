// Traffic-light verdict ring — green / yellow / red.
// A muted outer ring with a saturated inner dot. Used in the
// chat bubble (small), preview header (small), and result panel
// header (large).

import type { FC } from 'react'

type Verdict = 'green' | 'yellow' | 'red'

export const VerdictOrb: FC<{ verdict: Verdict; size?: number }> = ({ verdict, size = 36 }) => {
  const color =
    verdict === 'green' ? 'var(--green)' : verdict === 'yellow' ? 'var(--amber)' : 'var(--red)'
  const soft =
    verdict === 'green'
      ? 'var(--green-soft)'
      : verdict === 'yellow'
        ? 'var(--amber-soft)'
        : 'var(--red-soft)'
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: soft,
        border: `1px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: size * 0.4,
          height: size * 0.4,
          borderRadius: '50%',
          background: color,
        }}
      />
    </div>
  )
}

export type { Verdict }
