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
