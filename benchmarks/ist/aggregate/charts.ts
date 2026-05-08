// Hand-rolled SVG chart generators. No external deps. Charts are
// SVG strings; the caller writes them to disk.
//
// Two kinds:
//   * lineChart   — for series-over-iters (e.g. mean complexity)
//   * barChart    — for grouped bars (e.g. pass rate per template,
//                   one bar per system)

const COLORS = ['#2c7be5', '#e84a5f', '#3aa17e', '#f4b400', '#7e57c2', '#888888']

export type LineSeries = {
  label: string
  /** [x, y] pairs; x must be numeric (e.g. iter 1..5). */
  points: Array<[number, number]>
}

export type LineChartOptions = {
  title: string
  x_label: string
  y_label: string
  width?: number
  height?: number
  /** If supplied, overrides the auto-computed y range. */
  y_range?: [number, number]
}

export function lineChart(
  series: LineSeries[],
  opts: LineChartOptions,
): string {
  const W = opts.width ?? 640
  const H = opts.height ?? 360
  const M = { top: 40, right: 130, bottom: 50, left: 60 }
  const innerW = W - M.left - M.right
  const innerH = H - M.top - M.bottom

  const allX = series.flatMap((s) => s.points.map((p) => p[0]))
  const allY = series.flatMap((s) => s.points.map((p) => p[1]))
  const xMin = allX.length === 0 ? 0 : Math.min(...allX)
  const xMax = allX.length === 0 ? 1 : Math.max(...allX)
  const [yMin, yMax] =
    opts.y_range ??
    (allY.length === 0 ? [0, 1] : [Math.min(0, Math.min(...allY)), Math.max(...allY) * 1.1 + 0.001])

  const sx = (x: number): number =>
    M.left + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * innerW
  const sy = (y: number): number =>
    M.top + innerH - ((y - yMin) / Math.max(1e-6, yMax - yMin)) * innerH

  const xTicks = uniqueInts(xMin, xMax)
  const yTicks = niceTicks(yMin, yMax, 5)

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, -apple-system, Arial, sans-serif" font-size="12">`,
  )
  parts.push(`<rect width="${W}" height="${H}" fill="white"/>`)
  parts.push(
    `<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600">${esc(opts.title)}</text>`,
  )

  // Axes.
  parts.push(
    `<line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${M.top + innerH}" stroke="#444" stroke-width="1"/>`,
  )
  parts.push(
    `<line x1="${M.left}" y1="${M.top + innerH}" x2="${M.left + innerW}" y2="${M.top + innerH}" stroke="#444" stroke-width="1"/>`,
  )

  // Y ticks + gridlines.
  for (const t of yTicks) {
    const y = sy(t)
    parts.push(
      `<line x1="${M.left}" y1="${y}" x2="${M.left + innerW}" y2="${y}" stroke="#eee" stroke-width="1"/>`,
    )
    parts.push(
      `<text x="${M.left - 6}" y="${y + 4}" text-anchor="end" fill="#444">${formatTick(t)}</text>`,
    )
  }
  // X ticks.
  for (const t of xTicks) {
    const x = sx(t)
    parts.push(
      `<line x1="${x}" y1="${M.top + innerH}" x2="${x}" y2="${M.top + innerH + 4}" stroke="#444"/>`,
    )
    parts.push(
      `<text x="${x}" y="${M.top + innerH + 18}" text-anchor="middle" fill="#444">${t}</text>`,
    )
  }

  // Axis labels.
  parts.push(
    `<text x="${M.left + innerW / 2}" y="${H - 12}" text-anchor="middle" fill="#222">${esc(opts.x_label)}</text>`,
  )
  parts.push(
    `<text x="${20}" y="${M.top + innerH / 2}" text-anchor="middle" fill="#222" transform="rotate(-90, 20, ${M.top + innerH / 2})">${esc(opts.y_label)}</text>`,
  )

  // Series.
  series.forEach((s, i) => {
    const color = COLORS[i % COLORS.length]
    if (s.points.length > 0) {
      const path = s.points
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${sx(p[0]).toFixed(2)} ${sy(p[1]).toFixed(2)}`)
        .join(' ')
      parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`)
      for (const p of s.points) {
        parts.push(
          `<circle cx="${sx(p[0]).toFixed(2)}" cy="${sy(p[1]).toFixed(2)}" r="3" fill="${color}"/>`,
        )
      }
    }
    // Legend.
    const ly = M.top + 10 + i * 16
    const lx = M.left + innerW + 12
    parts.push(`<rect x="${lx}" y="${ly - 8}" width="14" height="3" fill="${color}"/>`)
    parts.push(`<text x="${lx + 18}" y="${ly}" fill="#222">${esc(s.label)}</text>`)
  })

  parts.push('</svg>')
  return parts.join('\n')
}

export type BarGroup = {
  label: string
  /** Map of series name → value (0..1 if y_range is rate-style). */
  values: Record<string, number>
}

export type BarChartOptions = {
  title: string
  x_label: string
  y_label: string
  width?: number
  height?: number
  y_range?: [number, number]
  /** Display each bar's value as a label above the bar. */
  show_values?: boolean
  /** Format function for value labels. */
  format_value?: (v: number) => string
}

export function barChart(
  groups: BarGroup[],
  series: string[],
  opts: BarChartOptions,
): string {
  const W = opts.width ?? 700
  const H = opts.height ?? 380
  const M = { top: 40, right: 150, bottom: 70, left: 60 }
  const innerW = W - M.left - M.right
  const innerH = H - M.top - M.bottom

  const allValues = groups.flatMap((g) => series.map((s) => g.values[s] ?? 0))
  const [yMin, yMax] = opts.y_range ?? [0, allValues.length === 0 ? 1 : Math.max(...allValues) * 1.15 + 0.001]

  const groupCount = groups.length
  const groupGap = 0.25 // proportion of group width as gap
  const groupWidth = innerW / Math.max(1, groupCount)
  const bandWidth = groupWidth * (1 - groupGap)
  const barWidth = bandWidth / Math.max(1, series.length)

  const sy = (y: number): number =>
    M.top + innerH - ((y - yMin) / Math.max(1e-6, yMax - yMin)) * innerH

  const yTicks = niceTicks(yMin, yMax, 5)

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, -apple-system, Arial, sans-serif" font-size="12">`,
  )
  parts.push(`<rect width="${W}" height="${H}" fill="white"/>`)
  parts.push(
    `<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="600">${esc(opts.title)}</text>`,
  )

  // Axes.
  parts.push(
    `<line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${M.top + innerH}" stroke="#444"/>`,
  )
  parts.push(
    `<line x1="${M.left}" y1="${M.top + innerH}" x2="${M.left + innerW}" y2="${M.top + innerH}" stroke="#444"/>`,
  )

  // Y ticks + gridlines.
  for (const t of yTicks) {
    const y = sy(t)
    parts.push(
      `<line x1="${M.left}" y1="${y}" x2="${M.left + innerW}" y2="${y}" stroke="#eee"/>`,
    )
    parts.push(
      `<text x="${M.left - 6}" y="${y + 4}" text-anchor="end" fill="#444">${formatTick(t)}</text>`,
    )
  }

  // Bars + group labels.
  groups.forEach((g, gi) => {
    const groupX = M.left + gi * groupWidth + (groupWidth * groupGap) / 2
    series.forEach((s, si) => {
      const v = g.values[s] ?? 0
      const x = groupX + si * barWidth
      const y = sy(Math.max(yMin, v))
      const h = sy(yMin) - y
      const color = COLORS[si % COLORS.length]
      parts.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(barWidth * 0.92).toFixed(2)}" height="${Math.max(0, h).toFixed(2)}" fill="${color}"/>`,
      )
      if (opts.show_values && v > 0) {
        const label = opts.format_value ? opts.format_value(v) : v.toFixed(2)
        parts.push(
          `<text x="${(x + barWidth / 2).toFixed(2)}" y="${(y - 3).toFixed(2)}" text-anchor="middle" fill="#222" font-size="10">${esc(label)}</text>`,
        )
      }
    })
    // Group label.
    parts.push(
      `<text x="${(groupX + bandWidth / 2).toFixed(2)}" y="${M.top + innerH + 22}" text-anchor="middle" fill="#222">${esc(g.label)}</text>`,
    )
  })

  // Legend.
  series.forEach((s, i) => {
    const ly = M.top + 10 + i * 18
    const lx = M.left + innerW + 12
    parts.push(`<rect x="${lx}" y="${ly - 9}" width="12" height="12" fill="${COLORS[i % COLORS.length]}"/>`)
    parts.push(`<text x="${lx + 18}" y="${ly}" fill="#222">${esc(s)}</text>`)
  })

  // Axis labels.
  parts.push(
    `<text x="${M.left + innerW / 2}" y="${H - 16}" text-anchor="middle" fill="#222">${esc(opts.x_label)}</text>`,
  )
  parts.push(
    `<text x="${20}" y="${M.top + innerH / 2}" text-anchor="middle" fill="#222" transform="rotate(-90, 20, ${M.top + innerH / 2})">${esc(opts.y_label)}</text>`,
  )

  parts.push('</svg>')
  return parts.join('\n')
}

// ─── helpers ────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function uniqueInts(min: number, max: number): number[] {
  const out: number[] = []
  for (let i = Math.ceil(min); i <= Math.floor(max); i++) out.push(i)
  return out
}

function niceTicks(min: number, max: number, target = 5): number[] {
  if (max <= min) return [min]
  const range = max - min
  const step0 = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  let step = mag
  if (norm < 1.5) step = mag
  else if (norm < 3) step = 2 * mag
  else if (norm < 7) step = 5 * mag
  else step = 10 * mag

  const out: number[] = []
  const start = Math.ceil(min / step) * step
  for (let v = start; v <= max + 1e-9; v += step) {
    out.push(Number(v.toFixed(6)))
  }
  if (out.length === 0) out.push(min, max)
  return out
}

function formatTick(v: number): string {
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(1)
  if (Math.abs(v) >= 100) return v.toFixed(0)
  if (Math.abs(v) >= 10) return v.toFixed(1)
  return v.toFixed(2)
}
