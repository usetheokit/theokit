import { describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'

import { createInMemoryRunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'
import { createInProcessThreadRunRegistry } from '../../packages/theo/src/server/agent/thread-run-registry.js'
import { postThreadFollowUp } from '../../packages/theo/src/server/agent/thread-dispatcher.js'

/**
 * M39 (ADR-0048) — the thread follow-up dispatcher. Drives the SDK `startRun`
 * over the M37 cache HEADLESS (no HTTP reader): idle ⇒ start + pump; active ⇒
 * queue; on terminal ⇒ dispatch the next FIFO follow-up as a continuation (same
 * sessionId ⇒ the SDK continues the conversation). Deterministic — `startRun` is
 * a fake generator, no LLM/HTTP.
 */

function chunk(delta: string): UIMessageChunk {
  return { type: 'text-delta', id: 't', delta } as UIMessageChunk
}

/** A controllable fake run: yields one chunk, then blocks until `release()` is called. */
function controllableRun() {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const gen = async function* (): AsyncGenerator<UIMessageChunk> {
    yield chunk('start')
    await gate
    yield chunk('end')
  }
  return { gen, release }
}

/** Wait until a runId has ended in the cache (the pump called cache.end → attach reports `ended`). */
async function waitEnded(cache: ReturnType<typeof createInMemoryRunEventCache>, runId: string) {
  for (let i = 0; i < 200; i++) {
    const res = cache.attach(
      runId,
      -1,
      () => {},
      () => {},
    )
    res.unsubscribe()
    if (res.ended) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`run ${runId} did not end`)
}

describe('M39 — thread-dispatcher', () => {
  it('posting to an IDLE thread starts a run and pumps chunks into the cache', async () => {
    const registry = createInProcessThreadRunRegistry()
    const cache = createInMemoryRunEventCache()
    const run = controllableRun()
    const startRun = vi.fn(() => run.gen())

    const res = postThreadFollowUp({ registry, cache, startRun }, 's1', 'hello')
    expect(res).toHaveProperty('runId')
    const runId = (res as { runId: string }).runId
    expect(registry.getActive('s1')).toBe(runId)
    expect(cache.has(runId)).toBe(true)
    expect(startRun).toHaveBeenCalledWith('s1', 'hello')

    run.release()
    await waitEnded(cache, runId)
    expect(registry.getActive('s1')).toBeNull() // cleared on terminal
  })

  it('posting to an ACTIVE thread QUEUEs; the queued follow-up dispatches as a continuation on terminal', async () => {
    const registry = createInProcessThreadRunRegistry()
    const cache = createInMemoryRunEventCache()
    const first = controllableRun()
    const second = controllableRun()
    const startRun = vi
      .fn<(s: string, m: string) => AsyncIterable<UIMessageChunk>>()
      .mockImplementationOnce(() => first.gen())
      .mockImplementationOnce(() => second.gen())

    const r1 = postThreadFollowUp({ registry, cache, startRun }, 's1', 'first') as { runId: string }
    // Thread is active → the second post is queued (no new run yet).
    const r2 = postThreadFollowUp({ registry, cache, startRun }, 's1', 'second')
    expect(r2).toEqual({ queued: true })
    expect(startRun).toHaveBeenCalledTimes(1)

    // End the first run → the queued 'second' dispatches as a continuation (same sessionId).
    first.release()
    await waitEnded(cache, r1.runId)
    // The continuation started with the SAME sessionId (conversation continuity is the SDK's job).
    expect(startRun).toHaveBeenCalledTimes(2)
    expect(startRun).toHaveBeenNthCalledWith(2, 's1', 'second')
    const contRunId = registry.getActive('s1')
    expect(contRunId).not.toBeNull()
    expect(contRunId).not.toBe(r1.runId) // a distinct runId for the continuation

    second.release()
    await waitEnded(cache, contRunId!)
    expect(registry.getActive('s1')).toBeNull()
  })

  it('a run whose SDK generator throws immediately still ends cleanly (no state leak)', async () => {
    // MEDIUM-2 — e.g. compileAgentModule throws for a misconfigured agent. The
    // pump's finally MUST end the run + clear the thread (subscriber gets [DONE]).
    const registry = createInProcessThreadRunRegistry()
    const cache = createInMemoryRunEventCache()
    // An AsyncIterable that rejects on the first pull — models the SDK stream
    // throwing (e.g. compileAgentModule fails) before yielding any chunk.
    const startRun = (): AsyncIterable<UIMessageChunk> => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('compile boom')) }),
    })
    const res = postThreadFollowUp({ registry, cache, startRun }, 's1', 'x') as { runId: string }
    await waitEnded(cache, res.runId)
    expect(registry.getActive('s1')).toBeNull()
  })

  it('multiple queued follow-ups drain FIFO', async () => {
    const registry = createInProcessThreadRunRegistry()
    const cache = createInMemoryRunEventCache()
    const runs = [controllableRun(), controllableRun(), controllableRun()]
    let i = 0
    const order: string[] = []
    const startRun = vi.fn((_s: string, m: string) => {
      order.push(m)
      return runs[i++].gen()
    })

    const r1 = postThreadFollowUp({ registry, cache, startRun }, 's1', 'a') as { runId: string }
    postThreadFollowUp({ registry, cache, startRun }, 's1', 'b')
    postThreadFollowUp({ registry, cache, startRun }, 's1', 'c')

    runs[0].release()
    await waitEnded(cache, r1.runId)
    const rb = registry.getActive('s1')!
    runs[1].release()
    await waitEnded(cache, rb)
    const rc = registry.getActive('s1')!
    runs[2].release()
    await waitEnded(cache, rc)

    expect(order).toEqual(['a', 'b', 'c']) // FIFO
    expect(registry.getActive('s1')).toBeNull()
  })
})
