/**
 * B-043 — an unparseable review is an error, not a clean verdict.
 *
 * `parseReviewOutput` fell through to `{ findings: [], overall_correctness: '', overall_explanation:
 * raw }`. That is the SAME structured value a review with nothing to report produces, so a caller
 * branching on `findings.length` or on `overall_correctness` could not tell "the reviewer found
 * nothing" from "the reviewer's answer could not be read" — on a tool whose entire purpose is
 * reporting defects. The rendered string carried a hint, so the failure was visible to a human
 * reading prose and invisible to anything reading the object.
 */
import { describe, expect, it } from 'vitest'

import { ReviewOutputUnparseableError, parseReviewOutput } from '../../src/review/parse.js'

describe('B-043 — a clean review and an unreadable one are different facts', () => {
  it('test_a_review_with_no_findings_parses_to_an_empty_list', () => {
    // Anti-vacuity floor, and the case that must NOT throw: a genuine clean verdict.
    const out = parseReviewOutput(
      JSON.stringify({ findings: [], overall_correctness: 'patch is correct' }),
    )

    expect(out.findings).toEqual([])
    expect(out.overall_correctness).toBe('patch is correct')
  })

  it('test_a_review_with_findings_parses_them', () => {
    const out = parseReviewOutput(
      JSON.stringify({ findings: [{ title: 'off-by-one', body: 'x' }], overall_correctness: 'no' }),
    )

    expect(out.findings).toHaveLength(1)
  })

  it('test_an_unparseable_response_raises_the_typed_error', () => {
    expect(
      () => parseReviewOutput('I could not complete the review because the diff was too large.'),
      'an unreadable answer produced the same object as a clean review',
    ).toThrow(ReviewOutputUnparseableError)
  })

  it('test_an_empty_response_raises_the_typed_error', () => {
    // `runReview` passes `result.result ?? ''`, so a run that returned nothing arrives here as ''.
    expect(() => parseReviewOutput('')).toThrow(ReviewOutputUnparseableError)
  })

  it('test_json_embedded_in_prose_is_still_recovered', () => {
    // The brace-slice fallback is deliberate and stays: models wrap JSON in commentary.
    const out = parseReviewOutput(
      'Here is my review:\n{"findings": [], "overall_correctness": "fine"}\nHope that helps.',
    )

    expect(out.overall_correctness).toBe('fine')
  })
})
