/**
 * B-294 — the probe promised an acceptance it never read.
 *
 * Its header said *"Exit 0 the run produced a span and the exporter reported it accepted"*. Nothing
 * reported anything: `TheoCloudObservabilityAdapter.flush()` awaits the POST for its side effect and
 * discards the response, catching and logging a transport error without rethrowing. So `await flush()`
 * resolved the same way whether the span was stored, refused with a 500, or never sent — and exit 0
 * was unconditional while exit 1 needed an uncaught exception.
 *
 * Measured before any of this existed, against a receiver that refused an unknown path (so the
 * probe's own control passed) and answered 404 on `/v1/traces`: the span was REFUSED, the probe exited
 * 0, and it printed the epilogue telling the operator to go read back a span the collector had
 * discarded.
 *
 * These cases pin the two halves the probe now rests on: what was observed leaving the process, and
 * what that observation permits it to claim.
 */
import { describe, expect, it } from 'vitest'

import {
  deliveryVerdict,
  recordDeliveriesTo,
  type DeliveryAttempt,
} from '../../scripts/lib/otlp-delivery.js'

const INGEST = 'http://127.0.0.1:14318/v1/traces'

/** A `fetch` that answers `status` for every call, or throws when `status` is an Error. */
function answering(status: number | Error): typeof globalThis.fetch {
  return (() => {
    if (status instanceof Error) return Promise.reject(status)
    return Promise.resolve(new Response('{}', { status }))
  }) as typeof globalThis.fetch
}

describe('recordDeliveriesTo — it watches, it does not answer', () => {
  it('Given a call to the ingest URL, Then the status is noted and the real response returned', async () => {
    const { fetch: recording, attempts } = recordDeliveriesTo(INGEST, answering(200))
    const response = await recording(INGEST, { method: 'POST', body: '{}' })

    // The caller gets the collector's own response, unmodified. A wrapper that returned anything else
    // would be a stub, and the probe's claim to measure the real transport would go with it.
    expect(response.status).toBe(200)
    expect(attempts).toEqual([{ status: 200 }])
  })

  it('Given a call to any other URL, Then it passes through unwatched', async () => {
    // The agent's own LLM call goes out through this same function. Counting it would report a
    // delivery for a span nobody exported — the probe would pass with the exporter switched off.
    const { fetch: recording, attempts } = recordDeliveriesTo(INGEST, answering(200))
    await recording('https://api.anthropic.com/v1/messages', { method: 'POST' })
    expect(attempts).toEqual([])
  })

  it('Given the same endpoint written differently, Then it is still the same endpoint', async () => {
    // Normalised rather than string-compared: a delivery missed because the URL was spelled with a
    // default port reads as "no span was ever sent", which is a different diagnosis entirely.
    const { fetch: recording, attempts } = recordDeliveriesTo(
      'http://127.0.0.1:14318/v1/traces',
      answering(200),
    )
    await recording(new URL('http://127.0.0.1:14318/v1/traces'), { method: 'POST' })
    await recording(new Request('http://127.0.0.1:14318/v1/traces', { method: 'POST' }))
    expect(attempts).toHaveLength(2)
  })

  it('Given the transport throws, Then it is recorded AND rethrown', async () => {
    const boom = new Error('ECONNRESET')
    const { fetch: recording, attempts } = recordDeliveriesTo(INGEST, answering(boom))

    await expect(recording(INGEST, { method: 'POST' })).rejects.toThrow('ECONNRESET')
    // Rethrown on purpose. The adapter has its own opinion about a failed flush; an observer that
    // absorbed the error would change the behaviour it claims only to watch.
    expect(attempts).toEqual([{ status: null, error: 'ECONNRESET' }])
  })
})

describe('deliveryVerdict — exit 0 is earned, not assumed', () => {
  it('Given nothing was ever POSTed, Then exit 1 says no span was produced', () => {
    const v = deliveryVerdict(INGEST, [])
    expect(v.code).toBe(1)
    expect(v.message).toMatch(/no span/i)
  })

  it('Given the collector accepted, Then exit 0', () => {
    expect(deliveryVerdict(INGEST, [{ status: 200 }]).code).toBe(0)
  })

  it('Given the collector refused, Then exit 1 naming the status', () => {
    // The measured case: 404 on `/v1/traces` from a receiver that could refuse, which used to exit 0.
    const v = deliveryVerdict(INGEST, [{ status: 404 }])
    expect(v.code).toBe(1)
    expect(v.message).toContain('404')
  })

  it('Given a 5xx, Then exit 1 — the whole refusal range, not one point in it', () => {
    expect(deliveryVerdict(INGEST, [{ status: 500 }]).code).toBe(1)
    expect(deliveryVerdict(INGEST, [{ status: 400 }]).code).toBe(1)
    // 399 is not a refusal, on the same boundary `endpointCanRefuse` already uses.
    expect(deliveryVerdict(INGEST, [{ status: 399 }]).code).toBe(0)
  })

  it('Given the transport never reached the collector, Then exit 1 carries the cause', () => {
    const v = deliveryVerdict(INGEST, [{ status: null, error: 'ECONNRESET' }])
    expect(v.code).toBe(1)
    expect(v.message).toContain('ECONNRESET')
  })

  it('Given one batch accepted and another refused, Then exit 1 — a partial loss is not a delivery', () => {
    // The exporter flushes in batches. Reporting "at least one got through" as success would call a
    // run that lost spans a successful delivery.
    const mixed: DeliveryAttempt[] = [{ status: 200 }, { status: 503 }]
    expect(deliveryVerdict(INGEST, mixed).code).toBe(1)
    expect(deliveryVerdict(INGEST, mixed).message).toContain('503')
  })

  it('Given every documented code, Then the verdict only ever speaks of 0 or 1', () => {
    // Exit 2 is "could not measure" and is decided before any delivery exists, by the control. This
    // function must never reach for it: a run that measured and failed is a different fact from one
    // that could not measure, and the probe's header keeps them apart.
    const codes = [
      deliveryVerdict(INGEST, []),
      deliveryVerdict(INGEST, [{ status: 200 }]),
      deliveryVerdict(INGEST, [{ status: 404 }]),
    ].map((v) => v.code)
    expect(codes).toEqual([1, 0, 1])
  })
})
