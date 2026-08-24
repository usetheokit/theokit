/**
 * A custom adapter receives the span's place in the trace, like the built-in
 * ones do (usetheokit/theokit#368).
 *
 * `defineObservabilityAdapter` returns an `ObservabilityAdapter`, whose
 * `startSpan` takes a context. If the wrapper dropped that argument the type
 * would still be satisfied and every self-hosted Datadog / Honeycomb / Grafana
 * adapter would be permanently trace-blind, with nothing saying so.
 */
import { describe, it, expect } from 'vitest'

import { defineObservabilityAdapter } from '../../src/server/observability/define-adapter.js'
import type { SpanContextInput } from '../../src/server/observability/adapters/types.js'

describe('defineObservabilityAdapter', () => {
  it('forwards the span context to the custom implementation', () => {
    const seen: (SpanContextInput | undefined)[] = []
    const noopHandle = { setAttribute() {}, setStatus() {}, end() {} }

    const adapter = defineObservabilityAdapter({
      name: 'custom',
      startSpan(_name, _attrs, context) {
        seen.push(context)
        return noopHandle
      },
      counter() {},
      histogram() {},
      log() {},
      flush: async () => {},
      shutdown: async () => {},
    })

    const context = {
      traceId: '0123456789abcdef0123456789abcdef',
      parentSpanId: 'a1b2c3d4e5f60718',
    }
    adapter.startSpan('agent.tool', { agent: 'chat' }, context)
    adapter.startSpan('agent.run')

    expect(seen).toEqual([context, undefined])
  })
})
