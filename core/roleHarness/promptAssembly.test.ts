import { describe, it, expect } from 'vitest'
import {
  assembleSystemPrompt,
  loadPromptFile,
  _clearPromptCacheForTesting,
} from './promptAssembly.js'
import { POLYCODER_PROMPT_BOUNDARY } from '@providers/prepareSystemPrompt.js'
import { emptyProjectMemory } from '@core/types/projectMemory.js'
import { randomUUID } from 'node:crypto'

describe('loadPromptFile', () => {
  it('reads docs/prompts/00-shared-preamble.md', () => {
    _clearPromptCacheForTesting()
    const text = loadPromptFile('00-shared-preamble.md')
    expect(text).toContain('Shared preamble')
  })

  it('reads role-specific prompt files', () => {
    const text = loadPromptFile('03-architect.md')
    expect(text).toContain('Architect')
    expect(text).toContain('memory')
  })

  it('caches subsequent reads (different content if file changed mid-test would be ignored)', () => {
    const a = loadPromptFile('00-shared-preamble.md')
    const b = loadPromptFile('00-shared-preamble.md')
    expect(a).toBe(b) // identity, not just equality
  })
})

describe('assembleSystemPrompt', () => {
  const dynamic = {
    workspace_name: 'My App',
    iteration_number: 3,
    project_memory: emptyProjectMemory(randomUUID()),
    total_iterations: 2,
  }

  it('produces shared preamble + role prefix + boundary + dynamic suffix', () => {
    const prompt = assembleSystemPrompt('translator', dynamic)
    // Shared preamble should appear first.
    expect(prompt).toContain('Shared preamble')
    // Role-specific content should follow.
    expect(prompt).toContain('Translator')
    // Boundary marker present.
    expect(prompt).toContain(POLYCODER_PROMPT_BOUNDARY)
    // Dynamic suffix referencing workspace + iteration.
    expect(prompt).toContain('My App')
    expect(prompt).toContain('iteration 3')
  })

  it("works for all 8 roles", () => {
    const roles = [
      'translator',
      'designer',
      'architect',
      'coder',
      'adversary',
      'long_term_critic',
      'test_runner',
      'communicator',
    ] as const
    for (const role of roles) {
      const out = assembleSystemPrompt(role, dynamic)
      expect(out).toContain(POLYCODER_PROMPT_BOUNDARY)
      expect(out.length).toBeGreaterThan(500)
    }
  })

  it('reflects empty memory when project_memory is null', () => {
    const out = assembleSystemPrompt('coder', { ...dynamic, project_memory: null })
    expect(out).toContain('first iteration')
  })

  it('summarizes memory counts when present', () => {
    const mem = emptyProjectMemory(randomUUID())
    mem.decisions.push({
      id: randomUUID(),
      decision: 'use SQLite',
      rationale: 'simplicity',
      supersedes: null,
      superseded_by: null,
      added_in_iteration: 1,
      added_at: Date.now(),
    })
    const out = assembleSystemPrompt('architect', { ...dynamic, project_memory: mem })
    expect(out).toContain('decisions: 1')
    expect(out).toContain('use SQLite')
  })

  it('boundary marker appears exactly once in the assembled prompt', () => {
    const out = assembleSystemPrompt('translator', dynamic)
    const matches = out.match(new RegExp(POLYCODER_PROMPT_BOUNDARY, 'g')) ?? []
    expect(matches.length).toBe(1)
  })
})
