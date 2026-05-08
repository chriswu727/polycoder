// Architect synthesis-discipline detector. Per ADR-012 + docs/specs/
// orchestrator.md §7. Architect outputs that delegate understanding
// (e.g. "based on the prior role's findings...") instead of restating
// facts are flagged for re-prompt.
//
// Lives in core/orchestrator/ because it's used both by the role
// harness (during invokeRole's per-role retry loop) and by the
// orchestrator's audit layer.

const FORBIDDEN_PHRASES: RegExp[] = [
  /based on (the |)(prior|previous|earlier) (analysis|findings|output|role)/i,
  /per the (Translator|Designer|spec|design|analysis)/i,
  /as (discussed|noted|mentioned) (above|earlier|previously)/i,
  /following the (patterns|guidance) (identified|established) (earlier|above)/i,
]

export type SynthesisDisciplineViolation = {
  phrase: string
  /** The full match (incl. casing as it appeared). */
  matched: string
}

/**
 * Scan a piece of text (typically the JSON-stringified Architect
 * payload) for synthesis-discipline violations. Returns matches in
 * the order they appear.
 */
export function detectSynthesisDiscipline(
  text: string,
): SynthesisDisciplineViolation[] {
  const out: SynthesisDisciplineViolation[] = []
  for (const re of FORBIDDEN_PHRASES) {
    const m = text.match(re)
    if (m) {
      out.push({ phrase: re.source, matched: m[0] })
    }
  }
  return out
}

/**
 * Render a corrective re-prompt the orchestrator can paste into the
 * conversation when violations are detected. See
 * docs/specs/orchestrator.md §6.3.
 */
export function synthesisDisciplineRePrompt(
  violations: SynthesisDisciplineViolation[],
): string {
  const samples = violations
    .slice(0, 3)
    .map((v) => `  - "${v.matched}"`)
    .join('\n')
  return [
    'Your previous output contained synthesis-discipline violations:',
    samples,
    '',
    'These phrases delegate understanding instead of restating facts. Per ADR-012, the Architect role must restate the relevant facts (file paths, line numbers, specific patterns) so the Coder can act on your guidance without reading any other role\'s output.',
    '',
    'Re-emit your <role-output> envelope with concrete facts substituted in.',
  ].join('\n')
}
