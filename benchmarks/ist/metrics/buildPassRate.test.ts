import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { computeBPR } from './buildPassRate.js'

let workDir: string
let snapshotDir: string

beforeEach(() => {
  snapshotDir = mkdtempSync(join(tmpdir(), 'bpr-snap-'))
  workDir = mkdtempSync(join(tmpdir(), 'bpr-work-'))
})

afterEach(() => {
  rmSync(snapshotDir, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
})

describe('computeBPR — static path', () => {
  it('passes when index.html exists at root', async () => {
    writeFileSync(join(workDir, 'index.html'), '<html><body>hi</body></html>')

    const r = await computeBPR({ snapshot_dir: snapshotDir, work_dir: workDir })
    expect(r.status).toBe('pass')
    expect(r.build_kind).toBe('static')
    expect(r.served_dir).toBe(workDir)
  })

  it('fails when no index.html at root and no package.json', async () => {
    writeFileSync(join(workDir, 'random.txt'), 'unrelated')

    const r = await computeBPR({ snapshot_dir: snapshotDir, work_dir: workDir })
    expect(r.status).toBe('fail')
    expect(r.build_kind).toBe('static')
    expect(r.served_dir).toBeNull()
  })

  it('fails on a zero-byte index.html', async () => {
    writeFileSync(join(workDir, 'index.html'), '')

    const r = await computeBPR({ snapshot_dir: snapshotDir, work_dir: workDir })
    expect(r.status).toBe('fail')
  })
})

describe('computeBPR — package.json without build script', () => {
  it('passes if root index.html exists', async () => {
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'x' }))
    writeFileSync(join(workDir, 'index.html'), '<html></html>')

    const r = await computeBPR({ snapshot_dir: snapshotDir, work_dir: workDir })
    expect(r.status).toBe('pass')
    expect(r.build_kind).toBe('static')
  })

  it('fails if no root index.html', async () => {
    writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'x' }))

    const r = await computeBPR({ snapshot_dir: snapshotDir, work_dir: workDir })
    expect(r.status).toBe('fail')
    expect(r.build_kind).toBe('none')
  })
})

describe('computeBPR — error handling', () => {
  it('handles unparseable package.json', async () => {
    writeFileSync(join(workDir, 'package.json'), 'not json')

    const r = await computeBPR({ snapshot_dir: snapshotDir, work_dir: workDir })
    expect(r.status).toBe('fail')
    expect(r.applicable_reason).toMatch(/unparseable/)
  })
})

describe('computeBPR — actual install + build (slow)', () => {
  // These exercise the real install/build path with a tiny pnpm
  // project. Tagged slow; gated by IST_BPR_SLOW=1 so CI stays fast.
  const slow = process.env.IST_BPR_SLOW === '1'

  it.skipIf(!slow)('runs an actual pnpm install + build', async () => {
    // Minimal package.json with a no-op build that produces dist/index.html
    writeFileSync(
      join(workDir, 'package.json'),
      JSON.stringify({
        name: 'tiny',
        version: '0.0.1',
        private: true,
        scripts: {
          build: "mkdir -p dist && echo '<html>built</html>' > dist/index.html",
        },
      }),
    )
    // No deps so install is fast.
    writeFileSync(join(workDir, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n')

    const r = await computeBPR({ snapshot_dir: snapshotDir, work_dir: workDir })
    expect(r.status).toBe('pass')
    expect(r.build_kind).toBe('pnpm')
    expect(r.served_dir).toMatch(/dist$/)
  }, 60_000)
})
