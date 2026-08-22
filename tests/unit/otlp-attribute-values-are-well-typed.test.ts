import { describe, it, expect } from 'vitest'

import { serializeSpansToOtlp } from '../../packages/theo/src/server/observability/otlp-serializer.js'
import type { SpanData } from '../../packages/theo/src/server/observability/span.js'

/**
 * usetheokit/theokit#380 — every number went out as OTLP `intValue`, so
 * `cost.usd` reached the collector as `{"intValue":"0.0031"}`: a string that is
 * not an integer, in the field reserved for integers. A collector may reject it,
 * coerce it to 0, or keep the string — none of those is the number, and cost is
 * the one attribute that answers what a run cost.
 *
 * The fix landed with no test. This is that test, and it reads the SERIALIZED
 * bytes rather than calling the private mapper, because the defect was in what
 * reached the wire and a unit test of the mapper would have passed either way
 * had it existed.
 *
 * The integer rule is `Number.isInteger`, not "does the literal have a decimal
 * point". `2.0` IS `2` in JavaScript, so a syntax-based rule would make the wire
 * shape depend on how someone typed a literal — a stranger rule than the bug.
 */

function span(attributes: Record<string, string | number | boolean>): SpanData {
  return {
    name: 'agent.run',
    traceId: '0'.repeat(32),
    spanId: '0'.repeat(16),
    attributes,
    startTimeMs: 1,
    endTimeMs: 2,
  } as SpanData
}

/** The attribute as it appears on the wire. */
function wireValue(key: string, value: string | number | boolean): Record<string, unknown> {
  const bytes = serializeSpansToOtlp([span({ [key]: value })])
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
    resourceSpans: [
      { scopeSpans: [{ spans: [{ attributes: { key: string; value: unknown }[] }] }] },
    ]
  }
  const attr = payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.find((a) => a.key === key)
  expect(attr, `attribute ${key} never reached the payload`).toBeDefined()
  return attr!.value as Record<string, unknown>
}

describe('an OTLP attribute reaches the collector in the field its type belongs to (#380)', () => {
  it('test_a_fractional_number_is_a_double_and_not_a_string_in_the_integer_field', () => {
    // The reported case, verbatim: a cost of 0.0031 dollars.
    expect(wireValue('cost.usd', 0.0031)).toEqual({ doubleValue: 0.0031 })
  })

  it('test_the_value_survives_the_round_trip_as_a_number', () => {
    // `{"intValue":"0.0031"}` also "contains" the digits. What was lost is that a
    // consumer can read them as the number, so that is what is asserted.
    expect(wireValue('cost.usd', 0.0031).doubleValue).toBeCloseTo(0.0031, 10)
  })

  it('test_an_integer_still_goes_out_as_an_integer', () => {
    // OTLP's intValue is a string by spec — that part was never the bug.
    expect(wireValue('tokens.total', 1280)).toEqual({ intValue: '1280' })
  })

  it('test_a_whole_number_written_with_a_decimal_point_is_still_an_integer', () => {
    // `2.0` is `2` by the time it is a value. A rule keyed on the literal's
    // spelling would make the wire shape depend on the author's typing.
    expect(wireValue('tokens.total', 2.0)).toEqual({ intValue: '2' })
  })

  it('test_a_negative_fraction_is_a_double_too', () => {
    // A credit or an adjustment; the sign must not route it back to the integer field.
    expect(wireValue('cost.usd', -0.5)).toEqual({ doubleValue: -0.5 })
  })

  it('test_strings_and_booleans_keep_their_own_fields', () => {
    expect(wireValue('agent', 'chat')).toEqual({ stringValue: 'chat' })
    expect(wireValue('hitl.resume_observed', true)).toEqual({ boolValue: true })
  })
})
