/**
 * A run is one trace, not N traces of one span each (usetheokit/theokit#368).
 *
 * The defect these guard against was invisible for the usual reason: `SpanData`
 * carried no identity, so the OTLP serializer minted a `traceId` per span at
 * export time. Every export was well-formed, every test passed, and a collector
 * receiving a five-span agent run showed five unrelated traces. Nothing in the
 * suite asked whether two spans of the same run shared anything, because the
 * fixtures had nothing to share.
 */
import { describe, it, expect } from 'vitest'

import { serializeSpansToOtlp } from '../../src/server/observability/otlp-serializer.js'
import { SpanImpl } from '../../src/server/observability/span.js'

const HEX32 = /^[0-9a-f]{32}$/
const HEX16 = /^[0-9a-f]{16}$/

function otlpSpansOf(spans: ReturnType<SpanImpl['getData']>[]): {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
}[] {
  const parsed = JSON.parse(new TextDecoder().decode(serializeSpansToOtlp(spans))) as {
    resourceSpans: { scopeSpans: { spans: Record<string, string>[] }[] }[]
  }
  return parsed.resourceSpans[0].scopeSpans[0].spans as never
}

describe('span identity', () => {
  it('a root span mints a well-formed trace id and span id', () => {
    const data = new SpanImpl('agent.run').getData()

    expect(data.traceId).toMatch(HEX32)
    expect(data.spanId).toMatch(HEX16)
    expect(data.parentSpanId).toBeUndefined()
  })

  it('two root spans belong to different traces', () => {
    expect(new SpanImpl('a').getData().traceId).not.toBe(new SpanImpl('b').getData().traceId)
  })

  it('a child inherits the trace and points at its parent', () => {
    const run = new SpanImpl('agent.run').getData()
    const tool = new SpanImpl('agent.tool', undefined, {
      traceId: run.traceId,
      parentSpanId: run.spanId,
    }).getData()

    expect(tool.traceId).toBe(run.traceId)
    expect(tool.parentSpanId).toBe(run.spanId)
    expect(tool.spanId).not.toBe(run.spanId)
  })

  it('a caller may pin the span id so children can name it as parent', () => {
    const pinned = 'a1b2c3d4e5f60718'
    const data = new SpanImpl('agent.run', undefined, {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: pinned,
    }).getData()

    expect(data.spanId).toBe(pinned)
  })
})

describe('OTLP serialization carries the identity it was given', () => {
  it('does NOT mint a trace id — the exported id is the span own', () => {
    const run = new SpanImpl('agent.run')
    run.end()
    const data = run.getData()

    const [exported] = otlpSpansOf([data])

    // The regression in one line: before the fix this was a fresh random value
    // and the assertion below was the only thing that could have caught it.
    expect(exported.traceId).toBe(data.traceId)
    expect(exported.spanId).toBe(data.spanId)
  })

  it('every span of one run exports under a single trace id', () => {
    const run = new SpanImpl('agent.run')
    const runData = run.getData()
    const child = (name: string): ReturnType<SpanImpl['getData']> =>
      new SpanImpl(name, undefined, {
        traceId: runData.traceId,
        parentSpanId: runData.spanId,
      }).getData()

    const exported = otlpSpansOf([runData, child('agent.tool'), child('agent.hitl')])

    expect(new Set(exported.map((s) => s.traceId)).size).toBe(1)
    expect(exported.filter((s) => s.parentSpanId === runData.spanId)).toHaveLength(2)
  })

  it('a root span exports no parent, so the collector can find the tree root', () => {
    const [exported] = otlpSpansOf([new SpanImpl('agent.run').getData()])

    expect(exported.parentSpanId === undefined || exported.parentSpanId === '').toBe(true)
  })
})
