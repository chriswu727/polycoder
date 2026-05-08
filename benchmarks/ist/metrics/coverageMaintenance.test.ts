import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { computeTCMR } from './coverageMaintenance.js'

let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'tcmr-'))
})
afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('computeTCMR', () => {
  it('na when no package.json', async () => {
    const r = await computeTCMR({ work_dir: work })
    expect(r.status).toBe('na')
    expect(r.applicable).toBe(false)
  })

  it('na when package.json has no test script', async () => {
    writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }))
    const r = await computeTCMR({ work_dir: work })
    expect(r.status).toBe('na')
    expect(r.test_command).toBeNull()
  })

  it('na for npm-init placeholder test script', async () => {
    writeFileSync(
      join(work, 'package.json'),
      JSON.stringify({
        name: 'x',
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    )
    const r = await computeTCMR({ work_dir: work })
    expect(r.status).toBe('na')
    expect(r.applicable_reason).toMatch(/placeholder/)
  })

  it('error when package.json is unparseable', async () => {
    writeFileSync(join(work, 'package.json'), 'not json')
    const r = await computeTCMR({ work_dir: work })
    expect(r.status).toBe('error')
  })
})
