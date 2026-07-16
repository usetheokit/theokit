/**
 * #136 — `consumeChunkStream` is the ONE consumer shared by the store's transport path
 * (`AgentClient.#drive`) and the Response/SSE path (`consumeUIMessageStream`). A provider failure
 * reaches it as a `{ type: 'error', errorText }` UIMessageChunk (the shape the in-process runner emits,
 * mirroring the SSE `event: error`). Before this fix, `readUIMessageStream({ stream })` was called with
 * no `onError`, so the error chunk was silently absorbed and the stream ended "clean". These tests pin
 * the contract: an error chunk REthrows (so the store's catch surfaces it), pre-error messages still
 * arrive, and a clean stream never throws.
 */
import { describe, expect, it, vi } from 'vitest'
import type { UIMessage, UIMessageChunk } from 'ai'

import { consumeChunkStream } from '../../packages/theo/src/client/consume-ui-message-stream.js'

/** Build a ReadableStream<UIMessageChunk> from literal chunks. */
function chunkStream(chunks: Array<Record<string, unknown>>): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c as UIMessageChunk)
      controller.close()
    },
  })
}

describe('consumeChunkStream (#136 — error surfacing)', () => {
  it('test_consumeChunkStream_rethrows_on_error_chunk', async () => {
    const stream = chunkStream([
      { type: 'start' },
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'Hi' },
      { type: 'text-end', id: 't0' },
      { type: 'error', errorText: 'OpenRouter: 401 No auth credentials found' },
    ])
    const seen: UIMessage[] = []
    await expect(consumeChunkStream(stream, (m) => seen.push(m))).rejects.toThrow(
      'OpenRouter: 401 No auth credentials found',
    )
    // The pre-error text was still delivered — a partial turn is not lost, only the failure is surfaced.
    const text = seen
      .at(-1)
      ?.parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(text).toBe('Hi')
  })

  it('test_consumeChunkStream_error_chunk_first_rethrows', async () => {
    const stream = chunkStream([{ type: 'start' }, { type: 'error', errorText: 'boom' }])
    const onMessage = vi.fn()
    await expect(consumeChunkStream(stream, onMessage)).rejects.toThrow('boom')
  })

  it('test_consumeChunkStream_happy_path_no_throw', async () => {
    const stream = chunkStream([
      { type: 'start' },
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'Hello' },
      { type: 'text-end', id: 't0' },
      { type: 'finish' },
    ])
    const seen: UIMessage[] = []
    await expect(consumeChunkStream(stream, (m) => seen.push(m))).resolves.toBeUndefined()
    const text = seen
      .at(-1)
      ?.parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(text).toBe('Hello')
  })
})
