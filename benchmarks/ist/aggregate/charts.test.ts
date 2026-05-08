import { describe, it, expect } from 'vitest'
import { lineChart, barChart } from './charts.js'

describe('lineChart', () => {
  it('emits an SVG with svg/path/circle elements for one series', () => {
    const svg = lineChart(
      [
        {
          label: 'mean complexity',
          points: [
            [1, 1.0],
            [2, 1.5],
            [3, 2.0],
            [4, 2.4],
            [5, 3.1],
          ],
        },
      ],
      { title: 'CCD over iters', x_label: 'iter', y_label: 'complexity' },
    )
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('<path')
    expect(svg.match(/<circle/g)?.length).toBe(5)
    expect(svg).toContain('CCD over iters')
    expect(svg).toContain('mean complexity')
  })

  it('handles empty series without throwing', () => {
    const svg = lineChart([{ label: 'empty', points: [] }], {
      title: 't',
      x_label: 'x',
      y_label: 'y',
    })
    expect(svg).toContain('<svg')
    // No <circle> for an empty series.
    expect(svg.match(/<circle/g)).toBeNull()
  })

  it('emits one legend entry per series', () => {
    const svg = lineChart(
      [
        { label: 'A', points: [[1, 1]] },
        { label: 'B', points: [[1, 2]] },
        { label: 'C', points: [[1, 3]] },
      ],
      { title: 't', x_label: 'x', y_label: 'y' },
    )
    expect(svg).toContain('>A<')
    expect(svg).toContain('>B<')
    expect(svg).toContain('>C<')
  })

  it('escapes HTML-special chars in labels', () => {
    const svg = lineChart(
      [{ label: 'a & b <c>', points: [[1, 1]] }],
      { title: 't', x_label: 'x', y_label: 'y' },
    )
    expect(svg).toContain('&amp;')
    expect(svg).toContain('&lt;')
    expect(svg).toContain('&gt;')
    expect(svg).not.toContain('a & b <c>')
  })
})

describe('barChart', () => {
  it('emits a rect per (group, series) cell', () => {
    const svg = barChart(
      [
        { label: 'todo', values: { full: 1.0, coderOnly: 0.6, lovable: 0.8 } },
        { label: 'dashboard', values: { full: 0.8, coderOnly: 0.4, lovable: 0.6 } },
      ],
      ['full', 'coderOnly', 'lovable'],
      { title: 'BPR by template', x_label: 'template', y_label: 'rate', y_range: [0, 1] },
    )
    expect(svg).toContain('<svg')
    // Each group has 3 series → 6 bars total. Plus the white background
    // rect and 3 legend swatches → 6+1+3 = 10 rects.
    const rectCount = svg.match(/<rect/g)?.length ?? 0
    expect(rectCount).toBeGreaterThanOrEqual(10)
    expect(svg).toContain('>todo<')
    expect(svg).toContain('>dashboard<')
  })

  it('renders value labels when show_values is on', () => {
    const svg = barChart(
      [{ label: 'a', values: { x: 0.5 } }],
      ['x'],
      {
        title: 't',
        x_label: 'x',
        y_label: 'y',
        show_values: true,
        format_value: (v) => `${(v * 100).toFixed(0)}%`,
      },
    )
    expect(svg).toContain('50%')
  })
})
