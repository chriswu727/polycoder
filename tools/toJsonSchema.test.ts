import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildTool } from './ToolDef.js'
import { toolToSchema } from './toJsonSchema.js'

describe('toolToSchema', () => {
  it('produces a JSON Schema with correct shape', () => {
    const tool = buildTool({
      name: 'read_file',
      description: 'Read a file',
      inputSchema: z.object({
        path: z.string().describe('Workspace-relative path'),
        start_line: z.number().int().nonnegative().optional(),
      }),
      outputSchema: z.object({ content: z.string() }),
      call: async () => ({ content: 'x' }),
    })

    const schema = toolToSchema(tool)
    expect(schema.name).toBe('read_file')
    expect(schema.description).toBe('Read a file')

    const inp = schema.input_schema as {
      type?: string
      properties?: Record<string, unknown>
      required?: string[]
    }
    expect(inp.type).toBe('object')
    expect(inp.properties).toBeDefined()
    expect(Object.keys(inp.properties ?? {})).toContain('path')
  })

  it('marks required fields correctly', () => {
    const tool = buildTool({
      name: 'edit_file',
      description: 'Edit a file',
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
      }),
      outputSchema: z.object({}),
      call: async () => ({}),
    })
    const schema = toolToSchema(tool)
    const inp = schema.input_schema as { required?: string[] }
    expect(inp.required).toEqual(
      expect.arrayContaining(['path', 'old_string', 'new_string']),
    )
  })
})
