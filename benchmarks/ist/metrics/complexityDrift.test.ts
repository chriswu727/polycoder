import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { computeCCD } from './complexityDrift.js'

let snap: string

beforeEach(() => {
  snap = mkdtempSync(join(tmpdir(), 'ccd-'))
})
afterEach(() => {
  rmSync(snap, { recursive: true, force: true })
})

describe('computeCCD — applicability', () => {
  it('returns na when no source files exist', async () => {
    writeFileSync(join(snap, 'README.md'), '# x')
    writeFileSync(join(snap, 'index.html'), '<html></html>')
    const r = await computeCCD({ snapshot_dir: snap })
    expect(r.status).toBe('na')
    expect(r.applicable).toBe(false)
    expect(r.files_analyzed).toBe(0)
  })

  it('returns na for an empty snapshot directory', async () => {
    const r = await computeCCD({ snapshot_dir: snap })
    expect(r.status).toBe('na')
  })

  it('skips node_modules / dist / .git', async () => {
    mkdirSync(join(snap, 'node_modules'), { recursive: true })
    writeFileSync(join(snap, 'node_modules', 'should-skip.ts'), 'function f() {}')
    mkdirSync(join(snap, 'dist'), { recursive: true })
    writeFileSync(join(snap, 'dist', 'bundle.js'), 'function g() {}')
    const r = await computeCCD({ snapshot_dir: snap })
    // No top-level source files → na.
    expect(r.status).toBe('na')
  })
})

describe('computeCCD — real eslint pass', () => {
  // Uses the repo's own eslint binary via node_modules/.bin path.
  // Skip if eslint isn't on the path (sandbox / detached run).
  const slow = process.env.IST_CCD_SLOW !== '0'

  it.skipIf(!slow)('analyzes a single simple function (cyc complexity 1)', async () => {
    writeFileSync(
      join(snap, 'simple.js'),
      'function add(a, b) { return a + b; }\n',
    )
    const r = await computeCCD({
      snapshot_dir: snap,
      eslintBin: join(process.cwd(), 'node_modules', '.bin', 'eslint'),
    })
    expect(r.status).toBe('pass')
    expect(r.applicable).toBe(true)
    expect(r.files_analyzed).toBe(1)
    // Linear function → cyclomatic complexity 1
    expect(r.mean_complexity).toBe(1)
    expect(r.max_complexity).toBe(1)
  }, 30_000)

  it.skipIf(!slow)('detects higher complexity in a branchy function', async () => {
    writeFileSync(
      join(snap, 'branchy.js'),
      `
function classify(n) {
  if (n < 0) return 'neg';
  if (n === 0) return 'zero';
  if (n < 10) return 'small';
  if (n < 100) return 'med';
  if (n < 1000) return 'big';
  return 'huge';
}
`,
    )
    const r = await computeCCD({
      snapshot_dir: snap,
      eslintBin: join(process.cwd(), 'node_modules', '.bin', 'eslint'),
    })
    expect(r.status).toBe('pass')
    expect(r.mean_complexity).toBeGreaterThan(1)
    expect(r.max_complexity).toBeGreaterThanOrEqual(6)
  }, 30_000)
})
