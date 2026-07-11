import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  durableUiMessageStreamResponse,
  RUN_ID_HEADER,
} from '../../packages/theo/src/server/agent/durable-ui-message-stream-response.js'
import { createInMemoryRunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'

/**
 * M37 (ADR-0046 D2/D3) — the durable SSE encoder: same UIMessageStream wire plus
 * a monotonic `id:` per frame, a per-run cache tee, and the `x-theokit-run-id`
 * header so the client learns its reconnect key.
 */

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

async function* chunks(...items: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  for (const c of items) yield c
}

const START: UIMessageChunk = { type: 'start' } as UIMessageChunk
const DELTA: UIMessageChunk = { type: 'text-delta', id: 't1', delta: 'hi' } as UIMessageChunk

describe('M37 — durableUiMessageStreamResponse', () => {
  it('surfaces the runId in the x-theokit-run-id header + keeps the UIMessageStream content-type', () => {
    const cache = createInMemoryRunEventCache()
    const res = durableUiMessageStreamResponse(chunks(START), { runId: 'run-abc', cache })
    expect(res.headers.get(RUN_ID_HEADER)).toBe('run-abc')
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1')
  })

  it('emits each frame with a monotonic id: line then the [DONE] terminal', async () => {
    const cache = createInMemoryRunEventCache()
    const res = durableUiMessageStreamResponse(chunks(START, DELTA), { runId: 'r', cache })
    const body = await readAll(res)
    expect(body).toBe(
      `id: 0\ndata: ${JSON.stringify(START)}\n\n` +
        `id: 1\ndata: ${JSON.stringify(DELTA)}\n\n` +
        `data: [DONE]\n\n`,
    )
  })

  it('tees every frame into the cache and ends the run when the stream completes', async () => {
    const cache = createInMemoryRunEventCache()
    const res = durableUiMessageStreamResponse(chunks(START, DELTA), { runId: 'r', cache })
    await readAll(res) // drive the stream to completion

    const attached = cache.attach(
      'r',
      -1,
      () => {},
      () => {},
    )
    expect(attached.known).toBe(true)
    expect(attached.ended).toBe(true) // cache.end() fired on stream finish
    expect(attached.replay.map((f) => f.seq)).toEqual([0, 1])
    expect(attached.replay.map((f) => JSON.parse(f.data).type)).toEqual(['start', 'text-delta'])
  })

  it('ends the cached run even when the source iterable throws mid-stream (fail-clear)', async () => {
    const cache = createInMemoryRunEventCache()
    async function* boom(): AsyncIterable<UIMessageChunk> {
      yield START
      throw new Error('source aborted')
    }
    const res = durableUiMessageStreamResponse(boom(), { runId: 'r', cache })
    const body = await readAll(res)
    // the one good frame + the DONE terminal (never left hanging)
    expect(body).toContain('id: 0\n')
    expect(body).toContain('data: [DONE]\n\n')
    const attached = cache.attach(
      'r',
      -1,
      () => {},
      () => {},
    )
    expect(attached.ended).toBe(true)
  })
})
