interface ReviewFinding {
  title: string
  body: string
  confidence_score?: number
  priority?: number | null
  code_location?: {
    absolute_file_path: string
    line_range?: { start: number; end: number }
  }
}

export interface ReviewOutput {
  findings: ReviewFinding[]
  overall_correctness: string
  overall_explanation: string
  overall_confidence_score?: number
}

function coerce(parsed: unknown): ReviewOutput | undefined {
  if (parsed === null || typeof parsed !== 'object') return undefined
  const p = parsed as Record<string, unknown>
  if (!Array.isArray(p.findings)) return undefined
  return {
    findings: p.findings.filter(
      (f): f is ReviewFinding =>
        f !== null && typeof f === 'object' && typeof (f as { title?: unknown }).title === 'string',
    ),
    overall_correctness: typeof p.overall_correctness === 'string' ? p.overall_correctness : '',
    overall_explanation: typeof p.overall_explanation === 'string' ? p.overall_explanation : '',
    ...(typeof p.overall_confidence_score === 'number'
      ? { overall_confidence_score: p.overall_confidence_score }
      : {}),
  }
}

export function parseReviewOutput(raw: string): ReviewOutput {
  try {
    const out = coerce(JSON.parse(raw))
    if (out !== undefined) return out
  } catch {
    // fall through
  }
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      const out = coerce(JSON.parse(raw.slice(first, last + 1)))
      if (out !== undefined) return out
    } catch {
      // fall through
    }
  }
  // B-043 — an unparseable response used to degrade to `{ findings: [], overall_correctness: '' }`,
  // which is the SAME structured value a clean review produces. A caller branching on
  // `findings.length` or on `overall_correctness` could not tell "the reviewer found nothing" from
  // "the reviewer's answer could not be read" — on a tool whose entire purpose is reporting
  // defects. The rendered string did carry a hint, so the failure was visible to a human reading
  // prose and invisible to anything reading the object.
  throw new ReviewOutputUnparseableError(raw)
}

/** The reviewer answered, and the answer was not a review. */
export class ReviewOutputUnparseableError extends Error {
  override readonly name = 'ReviewOutputUnparseableError'
  readonly code = 'review_output_unparseable' as const
  readonly raw: string

  constructor(raw: string) {
    super(
      'the reviewer\'s response could not be parsed as a review. This is NOT "no findings": the ' +
        `answer was ${String(raw.trim().length)} characters and did not contain a usable JSON ` +
        'object.',
    )
    this.raw = raw
  }
}

function priorityPrefix(f: ReviewOutput['findings'][number]): string {
  if (typeof f.priority !== 'number' || /^\[P\d\]/.test(f.title)) return ''
  return `[P${String(f.priority)}] `
}

function locationSuffix(loc: ReviewOutput['findings'][number]['code_location']): string {
  if (loc === undefined) return ''
  const lines =
    loc.line_range !== undefined
      ? `:${String(loc.line_range.start)}-${String(loc.line_range.end)}`
      : ''
  return ` — ${loc.absolute_file_path}${lines}`
}

export function formatReviewFindings(output: ReviewOutput): string {
  const lines: string[] = []
  if (output.overall_explanation.length > 0) lines.push(output.overall_explanation, '')
  if (output.findings.length > 0) {
    lines.push('Full review comments:', '')
    for (const f of output.findings) {
      lines.push(`- ${priorityPrefix(f)}${f.title}${locationSuffix(f.code_location)}`)
      if (f.body.length > 0) lines.push(...f.body.split('\n').map((l) => `  ${l}`))
    }
    lines.push('')
  }
  if (output.overall_correctness.length > 0) lines.push(`Verdict: ${output.overall_correctness}`)
  const text = lines.join('\n').trim()
  return text.length > 0 ? text : 'Reviewer failed to output a response.'
}
