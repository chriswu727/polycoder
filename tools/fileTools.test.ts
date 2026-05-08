import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { openDatabase } from '../data/connection.js'
import { InMemoryKeystore } from '../electron/secrets/keystore.js'
import { readFileTool } from './readFile.js'
import { writeFileTool } from './writeFile.js'
import { editFileTool } from './editFile.js'
import { ToolError, type ToolContext } from './ToolDef.js'
import type { RoleType } from '@core/types/role.js'

let workspaceRoot: string
let db: Database.Database
let dbDir: string
let keystore: InMemoryKeystore

function makeCtx(role: RoleType): ToolContext {
  return {
    workspace_id: randomUUID(),
    workspace_root: workspaceRoot,
    iteration_id: randomUUID(),
    role,
    abort_signal: new AbortController().signal,
    emit_event: () => {},
    db,
    keystore,
    read_files_in_iteration: new Set<string>(),
    iteration_number: 1,
  }
}

beforeEach(() => {
  workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'polycoder-files-')))
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  writeFileSync(
    join(workspaceRoot, 'src', 'index.ts'),
    'line 1\nline 2\nline 3\n',
  )
  dbDir = mkdtempSync(join(tmpdir(), 'polycoder-files-db-'))
  db = openDatabase(join(dbDir, 'test.db'))
  keystore = new InMemoryKeystore()
})

afterEach(() => {
  db.close()
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

// ─── read_file ──────────────────────────────────────────────────────

describe('readFileTool', () => {
  it('reads a file and number-prefixes lines', async () => {
    const ctx = makeCtx('coder')
    const out = await readFileTool.call({ path: 'src/index.ts' }, ctx)
    expect(out.total_lines).toBe(4) // 3 lines + trailing empty from \n
    expect(out.content).toContain('1\tline 1')
    expect(out.content).toContain('2\tline 2')
    expect(out.path).toBe(join('src', 'index.ts'))
  })

  it('honors start_line / end_line', async () => {
    const ctx = makeCtx('coder')
    const out = await readFileTool.call(
      { path: 'src/index.ts', start_line: 2, end_line: 2 },
      ctx,
    )
    expect(out.content).toBe('2\tline 2')
  })

  it('records the path in read_files_in_iteration', async () => {
    const ctx = makeCtx('coder')
    await readFileTool.call({ path: 'src/index.ts' }, ctx)
    expect(ctx.read_files_in_iteration.size).toBe(1)
    const seen = [...ctx.read_files_in_iteration][0]
    expect(seen).toContain('src/index.ts')
  })

  it('throws file_not_found on missing path', async () => {
    const ctx = makeCtx('coder')
    await expect(readFileTool.call({ path: 'src/missing.ts' }, ctx)).rejects.toMatchObject({
      code: 'file_not_found',
    })
  })

  it('rejects path escape', async () => {
    const ctx = makeCtx('coder')
    await expect(readFileTool.call({ path: '../etc' }, ctx)).rejects.toBeInstanceOf(ToolError)
  })
})

// ─── write_file ─────────────────────────────────────────────────────

describe('writeFileTool', () => {
  it('creates a new file', async () => {
    const ctx = makeCtx('coder')
    const out = await writeFileTool.call(
      { path: 'src/new.ts', content: 'export {}\n' },
      ctx,
    )
    expect(out.bytes_written).toBeGreaterThan(0)
    expect(readFileSync(join(workspaceRoot, 'src/new.ts'), 'utf8')).toBe('export {}\n')
  })

  it('refuses to overwrite an existing file', async () => {
    const ctx = makeCtx('coder')
    await expect(
      writeFileTool.call({ path: 'src/index.ts', content: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('auto-creates parent dirs', async () => {
    const ctx = makeCtx('coder')
    await writeFileTool.call(
      { path: 'src/deep/nested/file.ts', content: '' },
      ctx,
    )
    expect(readFileSync(join(workspaceRoot, 'src/deep/nested/file.ts'), 'utf8')).toBe('')
  })

  it('test_runner can write *.test.ts but not non-test paths', async () => {
    const trCtx = makeCtx('test_runner')
    await expect(
      writeFileTool.call({ path: 'src/store.test.ts', content: '' }, trCtx),
    ).resolves.toMatchObject({ bytes_written: 0 })

    await expect(
      writeFileTool.call({ path: 'src/store.ts', content: '' }, trCtx),
    ).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('rejects path escape', async () => {
    const ctx = makeCtx('coder')
    await expect(
      writeFileTool.call({ path: '../escape.ts', content: '' }, ctx),
    ).rejects.toBeInstanceOf(ToolError)
  })
})

// ─── edit_file ──────────────────────────────────────────────────────

describe('editFileTool', () => {
  it('refuses without prior read', async () => {
    const ctx = makeCtx('coder')
    await expect(
      editFileTool.call(
        { path: 'src/index.ts', old_string: 'line 1', new_string: 'first', replace_all: false },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('replaces unique old_string', async () => {
    const ctx = makeCtx('coder')
    await readFileTool.call({ path: 'src/index.ts' }, ctx)

    const out = await editFileTool.call(
      { path: 'src/index.ts', old_string: 'line 2', new_string: 'middle', replace_all: false },
      ctx,
    )
    expect(out.replacements_made).toBe(1)
    expect(readFileSync(join(workspaceRoot, 'src/index.ts'), 'utf8')).toBe(
      'line 1\nmiddle\nline 3\n',
    )
  })

  it('refuses non-unique old_string without replace_all', async () => {
    writeFileSync(join(workspaceRoot, 'src/dup.ts'), 'a\nb\na\n')
    const ctx = makeCtx('coder')
    await readFileTool.call({ path: 'src/dup.ts' }, ctx)
    await expect(
      editFileTool.call(
        { path: 'src/dup.ts', old_string: 'a', new_string: 'X', replace_all: false },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('replaces all occurrences with replace_all:true', async () => {
    writeFileSync(join(workspaceRoot, 'src/dup.ts'), 'a\nb\na\n')
    const ctx = makeCtx('coder')
    await readFileTool.call({ path: 'src/dup.ts' }, ctx)

    const out = await editFileTool.call(
      { path: 'src/dup.ts', old_string: 'a', new_string: 'X', replace_all: true },
      ctx,
    )
    expect(out.replacements_made).toBe(2)
    expect(readFileSync(join(workspaceRoot, 'src/dup.ts'), 'utf8')).toBe('X\nb\nX\n')
  })

  it('rejects edit when old_string == new_string (no-op)', async () => {
    const ctx = makeCtx('coder')
    await readFileTool.call({ path: 'src/index.ts' }, ctx)
    await expect(
      editFileTool.call(
        { path: 'src/index.ts', old_string: 'line 2', new_string: 'line 2', replace_all: false },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('returns a unified diff', async () => {
    const ctx = makeCtx('coder')
    await readFileTool.call({ path: 'src/index.ts' }, ctx)
    const out = await editFileTool.call(
      { path: 'src/index.ts', old_string: 'line 1', new_string: 'first', replace_all: false },
      ctx,
    )
    expect(out.diff_unified).toContain('-line 1')
    expect(out.diff_unified).toContain('+first')
  })
})
