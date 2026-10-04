import type { WireChunk as UIMessageChunk } from '@theokit/presenter/wire'
import { describe, expect, it } from 'vitest'

import { consumeChunkStream } from '../../src/client/consume-ui-message-stream.js'

/**
 * #964: while a reply streamed, the TheoCode TUI stopped reading the keyboard, so Esc could not
 * interrupt it.
 *
 * Every chunk reconstructs a message and calls `onMessage`, and a renderer answers that with a
 * synchronous commit in a microtask. When the chunks are already buffered, reading the next one also
 * resolves in a microtask, so the whole backlog drained without the event loop ever running a
 * macrotask: no stdin, no timers (the spinner's elapsed counter froze), until the reply ended.
 * Measured on the TUI: a 400-line reply at 130-140% CPU, Esc ignored throughout.
 */

function bufferedReply(lines: number): ReadableStream<UIMessageChunk> {
  const chunks: UIMessageChunk[] = [
    { type: 'start' },
    { type: 'text-start', id: 't' },
    ...Array.from(
      { length: lines },
      (_, i): UIMessageChunk => ({
        type: 'text-delta',
        id: 't',
        delta: `${String(i + 1)}\n`,
      }),
    ),
    { type: 'text-end', id: 't' },
    { type: 'finish' },
  ]
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

/** What a renderer costs per update, as a busy wait. */
function slowRender(ms: number): () => void {
  return () => {
    const until = performance.now() + ms
    while (performance.now() < until) {
      // busy, like a synchronous terminal commit
    }
  }
}

describe('a streamed reply leaves the event loop room for input', () => {
  it('test_a_timer_fires_while_a_buffered_reply_is_still_being_consumed', async () => {
    let updates = 0
    let updatesWhenTimerFired: number | undefined
    const render = slowRender(2)
    setTimeout(() => {
      updatesWhenTimerFired = updates
    }, 0)

    await consumeChunkStream(bufferedReply(200), () => {
      updates += 1
      render()
    })

    expect(updatesWhenTimerFired, 'the timer never ran while the reply was consumed').toBeDefined()
    expect(updatesWhenTimerFired).toBeLessThan(updates)
  })

  it('test_the_reply_is_still_reconstructed_in_full', async () => {
    let last = ''
    const outcome = await consumeChunkStream(bufferedReply(50), (message) => {
      const part = message.parts.find((p) => p.type === 'text')
      last = part?.type === 'text' ? String(part.text) : ''
    })

    expect(outcome.terminated).toBe(true)
    expect(last.split('\n').filter(Boolean)).toHaveLength(50)
  })
})
