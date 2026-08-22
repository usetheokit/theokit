/**
 * The SSE envelope `streamAgentResponse` produces.
 *
 * Every case here used to assert the FRAMEWORK-event wire — `event: text_delta` +
 * `data: {"type":"text_delta",…}` — which usetheokit/theokit#386 measured as a format none of this
 * framework's own clients can read: `parseWireStream` validates each `data:` payload against
 * `wireChunkSchema` and silently drops what fails. The cases whose subject survives that change are
 * kept and re-pointed at the wire the encoder speaks now; what the WIRE itself must contain is
 * asserted next door in `agent-route-speaks-the-shipped-wire.test.ts`.
 *
 * Kept deliberately: the large-payload and empty-stream cases. Neither is about the vocabulary, and
 * both are about the envelope holding up — a 2 MB frame not being chunked into invalid SSE, and a
 * run with no events still producing a well-formed, terminated stream.
 */
import { describe, expect, it } from 'vitest'

import { streamAgentResponse, type StreamEvent } from '../../src/bridge/agent-sse-handler.js'

async function* mockStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) yield event
}

async function* errorStream(events: StreamEvent[], errorAt: number): AsyncGenerator<StreamEvent> {
  for (let i = 0; i < events.length; i++) {
    if (i === errorAt) throw new Error('Provider rate limited')
    yield events[i]!
  }
}

async function readBody(response: Response): Promise<string> {
  return response.text()
}

describe('SSE handler (Web Standard Response)', () => {
  it('test_sse_headers', async () => {
    const response = streamAgentResponse(mockStream([]))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    // #383 — proxies buffer a stream that says nothing about buffering.
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    // `connection` is hop-by-hop and Node's HTTP/2 rejects it — deliberately absent.
    expect(response.headers.get('connection')).toBeNull()
    await readBody(response)
  })

  it('test_sse_frames_are_well_formed', async () => {
    const output = await readBody(
      streamAgentResponse(mockStream([{ type: 'text_delta', content: 'Hello' }])),
    )

    // Every frame is `event: …\ndata: …\n\n`. The `event:` line is informational — `parseWireStream`
    // reads only `data:` — and kept so an `EventSource` consumer can dispatch on it.
    for (const frame of output.split('\n\n').filter((f) => f.length > 0)) {
      const [first] = frame.split('\n')
      expect(first?.startsWith('event: ') || first?.startsWith('data: ')).toBe(true)
    }
  })

  it('test_sse_error_mid_stream', async () => {
    const events: StreamEvent[] = [
      { type: 'text_delta', content: 'ok' },
      { type: 'text_delta', content: 'will-fail' },
    ]

    const output = await readBody(streamAgentResponse(errorStream(events, 1)))

    // A failure still reaches the client — as a chunk it can read, and #390-masked, because this is
    // the browser's copy. It used to arrive as `event: error` carrying the provider's own words.
    expect(output).toContain('data: {"type":"error"')
    expect(output).not.toContain('Provider rate limited')
  })

  it('test_sse_large_event', async () => {
    const largeContent = 'x'.repeat(2_000_000)

    const output = await readBody(
      streamAgentResponse(mockStream([{ type: 'text_delta', content: largeContent }])),
    )

    // The envelope holds a 2 MB payload in ONE frame rather than splitting it into halves that are
    // not valid SSE on their own.
    expect(output.length).toBeGreaterThan(2_000_000)
    expect(output).toContain('data: {"type":"text-delta"')
  })

  it('test_sse_empty_stream_is_still_terminated', async () => {
    // This asserted `toBe('')` — a stream that ended with nothing at all, which is exactly what a
    // dropped connection looks like (#384). A run with no events is still a run that FINISHED.
    const output = await readBody(streamAgentResponse(mockStream([])))

    expect(output).toContain('"type":"finish"')
    expect(output.endsWith('data: [DONE]\n\n')).toBe(true)
  })

  it('test_response_is_web_standard', async () => {
    const response = streamAgentResponse(mockStream([]))
    expect(response).toBeInstanceOf(Response)
    expect(response.body).toBeDefined()
    await readBody(response)
  })
})
