import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createInMemoryRunEventCache,
  type CachedFrame,
} from '../../packages/theo/src/server/agent/run-event-cache.js'

/**
 * M37 — the durable `RunEventCache` (ADR-0046 D4). Per-run ordered frame buffer
 * + live listeners; the load-bearing `attach()` snapshots replay frames AND
 * registers a live listener in one synchronous tick (no gap, no dup).
 */

describe('M37 — createInMemoryRunEventCache', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('append assigns a monotonic seq starting at 0', () => {
    const cache = createInMemoryRunEventCache()
    expect(cache.append('r1', 'a')).toBe(0)
    expect(cache.append('r1', 'b')).toBe(1)
    expect(cache.append('r1', 'c')).toBe(2)
    // a distinct run has its own sequence
    expect(cache.append('r2', 'x')).toBe(0)
  })

  it('attach on an unknown run reports known=false and replays nothing', () => {
    const cache = createInMemoryRunEventCache()
    const res = cache.attach(
      'ghost',
      -1,
      () => {},
      () => {},
    )
    expect(res.known).toBe(false)
    expect(res.replay).toEqual([])
    expect(res.ended).toBe(false)
    res.unsubscribe()
  })

  it('attach replays exactly the frames after `afterSeq`', () => {
    const cache = createInMemoryRunEventCache()
    cache.append('r', 'f0')
    cache.append('r', 'f1')
    cache.append('r', 'f2')

    const all = cache.attach(
      'r',
      -1,
      () => {},
      () => {},
    )
    expect(all.replay.map((f) => f.seq)).toEqual([0, 1, 2])
    all.unsubscribe()

    const after0 = cache.attach(
      'r',
      0,
      () => {},
      () => {},
    )
    expect(after0.replay.map((f) => f.seq)).toEqual([1, 2])
    expect(after0.replay.map((f) => f.data)).toEqual(['f1', 'f2'])
    after0.unsubscribe()
  })

  it('a live attach receives subsequent frames + the end signal (no gap, no dup)', () => {
    const cache = createInMemoryRunEventCache()
    cache.append('r', 'f0')
    cache.append('r', 'f1')

    const live: CachedFrame[] = []
    let ended = false
    // attach after seq 0 → replay must be [f1] only, then live from f2
    const res = cache.attach(
      'r',
      0,
      (f) => live.push(f),
      () => {
        ended = true
      },
    )
    expect(res.replay.map((f) => f.seq)).toEqual([1]) // no dup of f0, no gap
    expect(res.ended).toBe(false)

    cache.append('r', 'f2') // live
    cache.append('r', 'f3') // live
    cache.end('r')

    expect(live.map((f) => f.seq)).toEqual([2, 3]) // exactly the post-attach frames
    expect(ended).toBe(true)
    res.unsubscribe()
  })

  it('attach on an already-ended run replays all + ended=true and never fires onFrame', () => {
    const cache = createInMemoryRunEventCache()
    cache.append('r', 'f0')
    cache.append('r', 'f1')
    cache.end('r')

    const live: CachedFrame[] = []
    const res = cache.attach(
      'r',
      -1,
      (f) => live.push(f),
      () => {},
    )
    expect(res.replay.map((f) => f.seq)).toEqual([0, 1])
    expect(res.ended).toBe(true)
    // nothing live can arrive after end
    expect(live).toEqual([])
    res.unsubscribe()
  })

  it('unsubscribe stops further onFrame delivery', () => {
    const cache = createInMemoryRunEventCache()
    cache.append('r', 'f0')
    const live: CachedFrame[] = []
    const res = cache.attach(
      'r',
      -1,
      (f) => live.push(f),
      () => {},
    )
    res.unsubscribe()
    cache.append('r', 'f1')
    expect(live).toEqual([]) // unsubscribed before f1
  })

  it('has() reflects presence: false before append, true after, false after eviction', () => {
    vi.useFakeTimers()
    const cache = createInMemoryRunEventCache({ evictAfterMs: 1000 })
    expect(cache.has('r')).toBe(false)
    cache.append('r', 'f0')
    expect(cache.has('r')).toBe(true)
    cache.end('r')
    expect(cache.has('r')).toBe(true) // still cached during the eviction window
    vi.advanceTimersByTime(1001)
    expect(cache.has('r')).toBe(false)
  })

  it('evicts a run buffer after `evictAfterMs` past end() (deterministic clock)', () => {
    vi.useFakeTimers()
    const cache = createInMemoryRunEventCache({ evictAfterMs: 1000 })
    cache.append('r', 'f0')
    cache.end('r')
    // still known right after end
    expect(
      cache.attach(
        'r',
        -1,
        () => {},
        () => {},
      ).known,
    ).toBe(true)
    vi.advanceTimersByTime(1001)
    // evicted
    expect(
      cache.attach(
        'r',
        -1,
        () => {},
        () => {},
      ).known,
    ).toBe(false)
  })
})

/**
 * `end()` must not require a Node timer.
 *
 * It called `buf.evictTimer.unref()` unconditionally. `unref` is Node-only, and this module runs on
 * Workers too — so on a runtime where `setTimeout` returns a number, every terminated run threw
 * `TypeError: buf.evictTimer.unref is not a function`.
 *
 * ## The result is the opposite of the intuition, which is why it is measured and not reasoned
 *
 * Probed with two identical workers differing only in one line of `wrangler.toml`, 2026-09-28 (B-329):
 *
 *     workerd, no compatibility_flags        typeof setTimeout(...) = object   .unref() works
 *     workerd, ["nodejs_compat"]             typeof setTimeout(...) = number   .unref() THROWS
 *
 * The Node-compat flag is what removed the Node API — and that flag is exactly what this framework's
 * own Cloudflare adapter emits, so the failing configuration is the shipped one.
 *
 * ## What it cost, and why the cost was not local
 *
 * `durableUiMessageStreamResponse` called `cache.end(runId)` from `finish()` AFTER setting its
 * idempotence flag and BEFORE the terminal `[DONE]` frame. The throw skipped the terminator, the retry
 * found the flag set and returned, and the client waited until its own timeout. Both halves are fixed:
 * the trigger here, and the ordering there.
 */
describe('end() does not require a Node timer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('test_end_survives_a_setTimeout_that_returns_a_number', () => {
    // Exactly what workerd under `nodejs_compat` does. Stubbed rather than described, because the
    // whole defect was a claim about what `setTimeout` returns.
    vi.stubGlobal('setTimeout', (): number => 1)
    const cache = createInMemoryRunEventCache()
    cache.begin('r1')
    cache.append('r1', '{"type":"start"}')

    expect(() => {
      cache.end('r1')
    }, 'end() reached for a Node-only API, so every terminated run threw on Workers').not.toThrow()
  })

  it('test_end_still_unrefs_where_a_timer_has_it', () => {
    // COUNTERPROOF: the point of the call is not to keep a Node process alive for an eviction timer,
    // and a feature check that never fires would silently drop that. Asserted on the timer the stub
    // hands back.
    let unrefCalls = 0
    vi.stubGlobal('setTimeout', () => ({
      unref: (): void => {
        unrefCalls += 1
      },
    }))
    const cache = createInMemoryRunEventCache()
    cache.begin('r2')
    cache.end('r2')

    expect(
      unrefCalls,
      'the timer was never unref-ed, so a Node process is held open by an eviction',
    ).toBe(1)
  })

  it('test_end_still_marks_the_run_ended', () => {
    // COUNTERPROOF: a guard that swallowed the whole body would satisfy the first case. `has` is the
    // observable the transport and the reconnect path both read.
    vi.stubGlobal('setTimeout', (): number => 1)
    const cache = createInMemoryRunEventCache()
    cache.begin('r3')
    cache.end('r3')

    expect(
      cache.attach(
        'r3',
        0,
        () => undefined,
        () => undefined,
      ).ended,
    ).toBe(true)
  })
})
