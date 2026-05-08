import { describe, it, expect } from 'vitest'
import {
  ALL_TOOLS,
  DEFAULT_ROLE_ALLOWLISTS,
  toolsForRole,
} from './registry.js'
import { TOOL_NAMES } from './ToolDef.js'
import { ALL_ROLES } from '@core/types/role.js'

describe('ALL_TOOLS', () => {
  it('contains all 10 V0 tool names', () => {
    expect(Object.keys(ALL_TOOLS).sort()).toEqual([...TOOL_NAMES].sort())
  })

  it('every tool exposes required ToolDef fields', () => {
    for (const tool of Object.values(ALL_TOOLS)) {
      expect(tool.name).toBeTruthy()
      expect(tool.description.length).toBeGreaterThan(20)
      expect(typeof tool.call).toBe('function')
      expect(tool.inputSchema).toBeDefined()
      expect(tool.outputSchema).toBeDefined()
    }
  })
})

describe('DEFAULT_ROLE_ALLOWLISTS', () => {
  it('covers all 8 roles', () => {
    for (const role of ALL_ROLES) {
      expect(DEFAULT_ROLE_ALLOWLISTS[role]).toBeDefined()
    }
  })
})

describe('toolsForRole', () => {
  it("Translator gets ask_user_question (and only that)", () => {
    const tools = toolsForRole('translator')
    expect(tools.map((t) => t.name)).toEqual(['ask_user_question'])
  })

  it('Coder gets file ops + read_project_memory; NOT bash', () => {
    const tools = toolsForRole('coder').map((t) => t.name)
    expect(tools).toEqual(
      expect.arrayContaining(['read_file', 'write_file', 'edit_file', 'read_project_memory']),
    )
    expect(tools).not.toContain('bash')
    expect(tools).not.toContain('update_project_memory')
  })

  it('Architect can update memory; Coder cannot', () => {
    const archTools = toolsForRole('architect').map((t) => t.name)
    const coderTools = toolsForRole('coder').map((t) => t.name)
    expect(archTools).toContain('update_project_memory')
    expect(coderTools).not.toContain('update_project_memory')
  })

  it('Adversary cannot edit files', () => {
    const tools = toolsForRole('adversary').map((t) => t.name)
    expect(tools).not.toContain('write_file')
    expect(tools).not.toContain('edit_file')
    expect(tools).not.toContain('bash')
  })

  it('Test Runner gets bash + run_test_suite + write_file (test files only — enforced at call time)', () => {
    const tools = toolsForRole('test_runner').map((t) => t.name)
    expect(tools).toContain('bash')
    expect(tools).toContain('run_test_suite')
    expect(tools).toContain('write_file')
    expect(tools).not.toContain('edit_file')
  })

  it('Long-term Critic gets read_history; Architect also gets read_history', () => {
    expect(toolsForRole('long_term_critic').map((t) => t.name)).toContain('read_history')
    expect(toolsForRole('architect').map((t) => t.name)).toContain('read_history')
  })

  it('Designer gets read_file + read_design_tokens (read-only)', () => {
    const tools = toolsForRole('designer').map((t) => t.name)
    expect(tools).toEqual(expect.arrayContaining(['read_file', 'read_design_tokens']))
    expect(tools).not.toContain('write_file')
  })

  it('Communicator gets only read_project_memory', () => {
    expect(toolsForRole('communicator').map((t) => t.name)).toEqual(['read_project_memory'])
  })

  it('per-tool allowedRoles is defense-in-depth: hypothetical bad allowlist cannot leak bash to non-test_runner', () => {
    // Sanity: bash.allowedRoles is ['test_runner'] → even if the
    // role allowlist named 'bash' for, say, coder, the registry would
    // strip it. We verify by reading the field directly.
    const bash = ALL_TOOLS.bash
    expect(bash.allowedRoles).toEqual(['test_runner'])
  })
})
