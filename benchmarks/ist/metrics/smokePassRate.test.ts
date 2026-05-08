// SPR exercises a real headless Chromium. CI doesn't have the
// Chromium download, so these tests are gated behind
// IST_FULL=1. To run locally:
//
//   pnpm exec playwright install chromium
//   IST_FULL=1 pnpm test benchmarks/ist/metrics/smokePassRate.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { computeSPR } from './smokePassRate.js'

const FULL = process.env.IST_FULL === '1'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spr-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('computeSPR — applicability', () => {
  it('returns na when served_dir is null', async () => {
    const r = await computeSPR({ served_dir: null, prior_golden: null })
    expect(r.spr.status).toBe('na')
    expect(r.spr.applicable).toBe(false)
    expect(r.golden).toBeNull()
  })

  it('returns na when served_dir does not exist', async () => {
    const r = await computeSPR({
      served_dir: '/no/such/dir/xxx',
      prior_golden: null,
    })
    expect(r.spr.status).toBe('na')
    expect(r.golden).toBeNull()
  })
})

describe('computeSPR — full browser pass (slow)', () => {
  it.skipIf(!FULL)('captures a golden on iter 1 (no console errors)', async () => {
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><html><body>
        <h1>My Todo</h1>
        <input type="text" placeholder="Add a todo" />
        <button>Add</button>
        <ul></ul>
      </body></html>`,
    )
    const r = await computeSPR({ served_dir: dir, prior_golden: null })
    expect(r.spr.status).toBe('pass')
    expect(r.spr.console_errors).toEqual([])
    expect(r.golden).not.toBeNull()
    expect(r.golden!.interactive_count).toBeGreaterThanOrEqual(2) // input + button
    expect(r.golden!.text_fragments).toContain('My Todo')
    expect(r.golden!.text_fragments).toContain('Add')
  }, 60_000)

  it.skipIf(!FULL)('passes persistence when prior fragments still present', async () => {
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><html><body>
        <h1>My Todo</h1><h2>Categories</h2>
        <input placeholder="Add a todo" />
        <button>Add</button>
        <select><option>All</option></select>
      </body></html>`,
    )
    const prior = {
      text_fragments: ['My Todo', 'Add'],
      interactive_count: 2,
    }
    const r = await computeSPR({ served_dir: dir, prior_golden: prior })
    expect(r.spr.status).toBe('pass')
    expect(r.spr.persistence_check?.missing_text_fragments).toEqual([])
    expect(r.spr.persistence_check?.below_count_threshold).toBe(false)
  }, 60_000)

  it.skipIf(!FULL)('fails when prior fragments are missing', async () => {
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><html><body>
        <h1>Different App</h1>
        <button>Click</button>
      </body></html>`,
    )
    const prior = {
      text_fragments: ['My Todo', 'Add a todo'],
      interactive_count: 2,
    }
    const r = await computeSPR({ served_dir: dir, prior_golden: prior })
    expect(r.spr.status).toBe('fail')
    expect(r.spr.persistence_check?.missing_text_fragments.length).toBeGreaterThan(
      0,
    )
  }, 60_000)

  it.skipIf(!FULL)('catches a JS console error', async () => {
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><html><body>
        <h1>Crashy</h1>
        <script>throw new Error('boom on load')</script>
      </body></html>`,
    )
    const r = await computeSPR({ served_dir: dir, prior_golden: null })
    expect(r.spr.status).toBe('fail')
    expect(r.spr.console_errors.length).toBeGreaterThan(0)
    expect(r.spr.console_errors.some((e) => /boom/.test(e))).toBe(true)
  }, 60_000)
})
