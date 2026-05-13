import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildInputEnvelope } from './envelopeBuilder.js'
import { parseRoleOutput, EnvelopeParseError } from './envelopeParser.js'
import { emptyProjectMemory } from '@core/types/projectMemory.js'

// ─── envelopeBuilder ────────────────────────────────────────────────

describe('buildInputEnvelope', () => {
  it('produces a well-formed envelope for the Translator (no prior outputs)', () => {
    const xml = buildInputEnvelope({
      role: 'translator',
      iteration: 1,
      project_memory: null,
      task: 'build me a todo app',
    })
    // Translator gets a prelude that echoes the user prompt at the
    // very top so the model can't drift into parroting in-context
    // examples — see envelopeBuilder.ts and the smoke 4 incident
    // (round 2) in docs/quality-iteration.md.
    expect(xml).toContain('<<<USER_PROMPT_START>>>')
    expect(xml).toContain('build me a todo app')
    expect(xml).toContain('<<<USER_PROMPT_END>>>')
    expect(xml).toContain('<role-input role="translator" iteration="1">')
    expect(xml).toContain('<project_memory>null</project_memory>')
    expect(xml).toContain('<task>')
    expect(xml.endsWith('</role-input>')).toBe(true)
  })

  it('includes prior_outputs in stable role order', () => {
    const xml = buildInputEnvelope({
      role: 'coder',
      iteration: 2,
      project_memory: emptyProjectMemory(randomUUID()),
      prior_outputs: {
        translator: {
          role: 'translator',
          iteration: 2,
          model: 'm1',
          status: 'ok',
          summary: 'ts',
          payload: {},
        },
        designer: {
          role: 'designer',
          iteration: 2,
          model: 'm2',
          status: 'ok',
          summary: 'ds',
          payload: {},
        },
        architect: {
          role: 'architect',
          iteration: 2,
          model: 'm3',
          status: 'ok',
          summary: 'as',
          payload: {},
        },
      },
      task: { hint: 'implement spec' },
    })
    const tIdx = xml.indexOf('<translator_output>')
    const dIdx = xml.indexOf('<designer_output>')
    const aIdx = xml.indexOf('<architect_output>')
    expect(tIdx).toBeLessThan(dIdx)
    expect(dIdx).toBeLessThan(aIdx)
  })

  it('escapes XML special chars in free-text task', () => {
    const xml = buildInputEnvelope({
      role: 'translator',
      iteration: 1,
      project_memory: null,
      task: 'fix bug <script> & </script>',
    })
    expect(xml).toContain('&lt;script&gt; &amp; &lt;/script&gt;')
  })

  it('serializes structured task as JSON', () => {
    const xml = buildInputEnvelope({
      role: 'designer',
      iteration: 1,
      project_memory: null,
      task: { translator_output: { intent: 'x' } },
    })
    expect(xml).toContain('"translator_output"')
  })

  it('attaches ui_lang when provided', () => {
    const xml = buildInputEnvelope({
      role: 'communicator',
      iteration: 1,
      project_memory: null,
      task: '',
      ui_lang: 'zh-CN',
    })
    expect(xml).toContain('<ui_lang>zh-CN</ui_lang>')
  })
})

// ─── envelopeParser ─────────────────────────────────────────────────

const VALID_ENVELOPE = `<role-output role="translator" iteration="1" model="deepseek-chat">
  <status>ok</status>
  <summary>simple todo app spec</summary>
  <payload>
    {"intent_summary": "todo app", "must_have": ["add", "list"]}
  </payload>
</role-output>`

describe('parseRoleOutput — happy path', () => {
  it('parses a canonical envelope', () => {
    const env = parseRoleOutput(VALID_ENVELOPE)
    expect(env.role).toBe('translator')
    expect(env.iteration).toBe(1)
    expect(env.model).toBe('deepseek-chat')
    expect(env.status).toBe('ok')
    expect(env.summary).toBe('simple todo app spec')
    expect(env.payload).toEqual({
      intent_summary: 'todo app',
      must_have: ['add', 'list'],
    })
  })

  it('ignores prose before/after the envelope', () => {
    const text = `Here is my output:\n\n${VALID_ENVELOPE}\n\nThanks!`
    const env = parseRoleOutput(text)
    expect(env.role).toBe('translator')
  })

  it('strips outer markdown code fence', () => {
    const text = '```xml\n' + VALID_ENVELOPE + '\n```'
    const env = parseRoleOutput(text)
    expect(env.role).toBe('translator')
  })

  it('strips inner ```json fence around payload body', () => {
    const env = parseRoleOutput(`<role-output role="coder" iteration="2" model="x">
  <status>ok</status>
  <summary>wrote code</summary>
  <payload>
\`\`\`json
{"files_changed": []}
\`\`\`
  </payload>
</role-output>`)
    expect(env.payload).toEqual({ files_changed: [] })
  })

  it('accepts every documented status', () => {
    const statuses = [
      'ok', 'flagged', 'failed', 'partial', 'cannot_run', 'cannot_assess',
      'clean', 'passed', 'needs_clarification', 'conflict_detected',
      'memory_only', 'incomplete', 'healthy', 'warning', 'critical',
      'green', 'yellow', 'red',
    ]
    for (const s of statuses) {
      const env = parseRoleOutput(
        `<role-output role="translator" iteration="0" model="m"><status>${s}</status><summary>x</summary><payload>{}</payload></role-output>`,
      )
      expect(env.status).toBe(s)
    }
  })
})

describe('parseRoleOutput — failure modes', () => {
  it('throws no_envelope when none present', () => {
    expect(() => parseRoleOutput('just plain text')).toThrowError(EnvelopeParseError)
    try {
      parseRoleOutput('plain')
    } catch (e) {
      expect((e as EnvelopeParseError).reason.code).toBe('no_envelope')
    }
  })

  it('throws multiple_envelopes when more than one is present', () => {
    const two = VALID_ENVELOPE + '\n' + VALID_ENVELOPE
    try {
      parseRoleOutput(two)
      throw new Error('expected throw')
    } catch (e) {
      expect((e as EnvelopeParseError).reason.code).toBe('multiple_envelopes')
    }
  })

  it('throws malformed_attributes when role is unknown', () => {
    const text = `<role-output role="manager" iteration="1" model="m">
      <status>ok</status>
      <summary>x</summary>
      <payload>{}</payload>
    </role-output>`
    try {
      parseRoleOutput(text)
      throw new Error('expected throw')
    } catch (e) {
      expect((e as EnvelopeParseError).reason.code).toBe('malformed_attributes')
    }
  })

  it('throws invalid_iteration when negative', () => {
    const text = `<role-output role="coder" iteration="-1" model="m">
      <status>ok</status><summary>x</summary><payload>{}</payload></role-output>`
    try {
      parseRoleOutput(text)
      throw new Error('expected throw')
    } catch (e) {
      expect((e as EnvelopeParseError).reason.code).toBe('invalid_iteration')
    }
  })

  it('throws invalid_status on unknown status', () => {
    const text = `<role-output role="coder" iteration="1" model="m">
      <status>shipping</status><summary>x</summary><payload>{}</payload></role-output>`
    try {
      parseRoleOutput(text)
      throw new Error('expected throw')
    } catch (e) {
      expect((e as EnvelopeParseError).reason.code).toBe('invalid_status')
    }
  })

  it('throws missing_payload when payload tag absent', () => {
    const text = `<role-output role="coder" iteration="1" model="m">
      <status>ok</status><summary>x</summary>
    </role-output>`
    try {
      parseRoleOutput(text)
      throw new Error('expected throw')
    } catch (e) {
      expect((e as EnvelopeParseError).reason.code).toBe('missing_payload')
    }
  })

  it('throws payload_not_json on garbage payload', () => {
    const text = `<role-output role="coder" iteration="1" model="m">
      <status>ok</status><summary>x</summary>
      <payload>not really json</payload></role-output>`
    try {
      parseRoleOutput(text)
      throw new Error('expected throw')
    } catch (e) {
      expect((e as EnvelopeParseError).reason.code).toBe('payload_not_json')
    }
  })
})
