import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildTool, ToolError, type ToolDef } from './ToolDef.js'

describe('buildTool', () => {
  it('fills in safe defaults for isReadOnly and isConcurrencySafe', () => {
    const def: ToolDef<unknown, unknown> = {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.object({ content: z.string() }),
      call: async () => ({ content: 'x' }),
    }
    const built = buildTool(def)
    expect(built.isReadOnly({})).toBe(false)
    expect(built.isConcurrencySafe({})).toBe(false)
  })

  it('honors explicit overrides', () => {
    const built = buildTool({
      name: 'read_file',
      description: 'Read a file',
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.object({ content: z.string() }),
      call: async () => ({ content: 'x' }),
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
    })
    expect(built.isReadOnly({ path: 'x' })).toBe(true)
    expect(built.isConcurrencySafe({ path: 'x' })).toBe(true)
  })
})

describe('ToolError', () => {
  it('carries the structured fields', () => {
    const e = new ToolError('file_not_found', 'read_file', 'no file', false, { extra: 1 })
    expect(e.code).toBe('file_not_found')
    expect(e.tool_name).toBe('read_file')
    expect(e.recoverable).toBe(false)
    expect(e.raw_error).toEqual({ extra: 1 })
    expect(e.name).toBe('ToolError')
  })

  it('is throwable and instanceof Error', () => {
    expect(() => {
      throw new ToolError('invalid_input', 'write_file', 'bad', true)
    }).toThrow(ToolError)
  })
})
