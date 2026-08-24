/**
 * The route `generateAgentRoutes` mounts must speak the wire this framework's clients read
 * (usetheokit/theokit#386).
 *
 * There were TWO SSE encoders for agent runs and they did not agree. The durable one writes
 * `data: <UIMessageChunk>` and a terminal `data: [DONE]`; this one wrote
 * `event: <type>` + `data: <framework StreamEvent>` — snake_case agent events, not kebab-case wire
 * chunks — and no terminator at all.
 *
 * `parseWireStream` reads `data:` lines and runs `wireChunkSchema.safeParse` on the payload. A
 * framework `StreamEvent` fails that parse and is dropped through a `warn` whose default sink is a
 * no-op. So a `TheoApp` app mounted with `agentRuntime` served `POST {route}/chat` in a format none
 * of its own clients could read, the turn produced no assistant message, and the run reported
 * success with an empty answer — silently, at every layer.
 *
 * The missing terminator is the same defect #384 closed for the durable encoder: without a `finish`
 * chunk a client cannot tell a completed run from a dropped connection, and #384's fix keys on
 * exactly that chunk.
 */
import { describe, expect, it } from 'vitest'

import { streamAgentResponse, type StreamEvent } from '../../src/bridge/agent-sse-handler.js'

async function* events(...list: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of list) yield e
}

/** Read the `data:` payloads the way `parseWireStream` does — the only lines it looks at. */
async function dataPayloads(response: Response): Promise<string[]> {
  const body = await response.text()
  return body
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice('data: '.length))
}

describe('the generated agent route speaks the shipped wire (#386)', () => {
  it('emits wire chunks, not framework stream events', async () => {
    const payloads = await dataPayloads(
      streamAgentResponse(events({ type: 'text_delta', content: 'Hello' })),
    )

    const parsed = payloads
      .filter((p) => p !== '[DONE]')
      .map((p) => JSON.parse(p) as { type: string })
    // kebab-case wire chunk types, not the snake_case agent vocabulary.
    expect(parsed.map((c) => c.type)).toContain('text-delta')
    expect(parsed.map((c) => c.type)).not.toContain('text_delta')
  })

  it('every payload validates against the schema the client parses with', async () => {
    const { wireChunkSchema } = await import('@theokit/presenter/wire')
    const payloads = await dataPayloads(
      streamAgentResponse(events({ type: 'text_delta', content: 'Hi' })),
    )

    for (const payload of payloads) {
      if (payload === '[DONE]') continue
      const result = wireChunkSchema.safeParse(JSON.parse(payload))
      expect(result.success, `a frame the client would silently discard: ${payload}`).toBe(true)
    }
  })

  it('terminates the stream, so a completed run is distinguishable from a dropped one', async () => {
    // The defect #384 closed for the durable encoder, unfixed here: its fix keys on `finish`.
    const payloads = await dataPayloads(
      streamAgentResponse(events({ type: 'text_delta', content: 'Hi' })),
    )

    const parsed = payloads
      .filter((p) => p !== '[DONE]')
      .map((p) => JSON.parse(p) as { type: string })
    expect(parsed.map((c) => c.type)).toContain('finish')
    expect(payloads.at(-1)).toBe('[DONE]')
  })

  it('reports a mid-stream failure as a chunk the client understands', async () => {
    async function* fails(): AsyncGenerator<StreamEvent> {
      yield { type: 'text_delta', content: 'partial' }
      throw new Error('provider rate limited')
    }

    const payloads = await dataPayloads(streamAgentResponse(fails()))
    const parsed = payloads
      .filter((p) => p !== '[DONE]')
      .map((p) => JSON.parse(p) as { type: string })

    expect(parsed.map((c) => c.type)).toContain('error')
    // #390 — and it is masked, because this is the browser's copy.
    expect(payloads.join('\n')).not.toContain('provider rate limited')
  })

  it('keeps the SSE headers a client connects with', async () => {
    const response = streamAgentResponse(events())

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toContain('no-cache')
  })
})
