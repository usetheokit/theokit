import { describe, it, expect, vi, afterEach } from 'vitest'

import { TheoCloudObservabilityAdapter } from '../../packages/theo/src/server/observability/adapters/theo-cloud.js'

/**
 * usetheokit/theokit#353 — `flushIntervalMs` was accepted, defaulted to 5000 and
 * never read: there was no timer anywhere in the adapter. `pendingSpans` drained
 * only from `shutdown()`, which nothing called. So the exporter accumulated spans
 * for the life of the process and exported none of them.
 *
 * That is two defects wearing one shape. An option that promises behaviour it
 * does not have is the first; an unbounded buffer is the second, and it became
 * live the moment agent runs started producing spans.
 */

afterEach(() => {
  vi.useRealTimers()
})

function createAdapter(overrides: Record<string, unknown> = {}) {
  const posted: unknown[] = []
  const adapter = new TheoCloudObservabilityAdapter({
    ingestUrl: 'https://ingest.test/v1/traces',
    token: 'test-key-secret-fixture',
    _mockFetch: async (_url, init) => {
      posted.push(init?.body)
      return new Response('ok')
    },
    ...overrides,
  })
  return { adapter, posted }
}

function decodeBody(body: unknown): string {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  return String(body)
}

function endOneSpan(adapter: TheoCloudObservabilityAdapter, name = 'span'): void {
  adapter.startSpan(name).end()
}

describe('theo-cloud exporter drains on its own (#353)', () => {
  it('test_the_flush_interval_actually_flushes', async () => {
    vi.useFakeTimers()
    const { adapter, posted } = createAdapter({ flushIntervalMs: 1000 })

    endOneSpan(adapter)
    expect(posted).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1000)

    // Before this, the only drain was `shutdown()` — which nothing called, so a
    // long-running server exported nothing, ever.
    expect(posted).toHaveLength(1)
    await adapter.shutdown()
  })

  it('test_the_timer_does_not_keep_the_process_alive', () => {
    const { adapter } = createAdapter({ flushIntervalMs: 1000 })

    // A telemetry exporter that pins the event loop turns a clean exit into a
    // hang, which is a worse bug than the one it was added to fix.
    expect(adapter.hasUnrefdFlushTimer()).toBe(true)
    void adapter.shutdown()
  })

  it('test_the_buffer_is_bounded_and_says_what_it_dropped', async () => {
    const { adapter, posted } = createAdapter({ flushIntervalMs: 60_000, maxPendingSpans: 2 })

    endOneSpan(adapter, 'first')
    endOneSpan(adapter, 'second')
    endOneSpan(adapter, 'third')

    await adapter.flush()

    // Dropping is a real loss; the alternative is unbounded growth when the
    // collector is unreachable. What is not acceptable is losing it silently.
    // The body is the serialized OTLP payload as bytes, so it is decoded rather
    // than stringified — `String(uint8array)` is a comma-separated byte list that
    // contains no span name at all, and would make this assertion vacuous.
    const payload = decodeBody(posted[0])

    expect(posted).toHaveLength(1)
    expect(payload).toContain('third')
    expect(payload).toContain('second')
    expect(payload).not.toContain('first')
    expect(adapter.droppedSpanCount()).toBe(1)
  })

  it('test_shutdown_stops_the_timer_and_makes_a_final_flush', async () => {
    vi.useFakeTimers()
    const { adapter, posted } = createAdapter({ flushIntervalMs: 1000 })

    endOneSpan(adapter)
    await adapter.shutdown()
    expect(posted).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(5000)

    // No further posts: the timer is cleared, not merely ignored.
    expect(posted).toHaveLength(1)
  })

  it('test_an_idle_interval_posts_nothing', async () => {
    vi.useFakeTimers()
    const { adapter, posted } = createAdapter({ flushIntervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(5000)

    expect(posted).toHaveLength(0)
    await adapter.shutdown()
  })
})
