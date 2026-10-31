import { describe, it, expect, afterEach, vi } from 'vitest'

import { createCacheEngine } from '../../packages/theo/src/cache/cache-engine.js'
import type { CacheEngine } from '../../packages/theo/src/cache/cache-engine.js'
import { defineCachedRoute } from '../../packages/theo/src/cache/define-cached-route.js'
import { InMemoryCacheAdapter } from '../../packages/theo/src/cache/in-memory-adapter.js'

// B-667 — N concurrent requests for one cached-route key must run the handler once on a
// miss, and start at most one background revalidation on a stale hit.

const CONCURRENT_REQUESTS = 10
const URL_UNDER_TEST = 'https://x/api/single-flight'

function makeCtx(req: Request): {
  query: undefined
  body: undefined
  params: undefined
  request: Request
  ctx: unknown
} {
  return { query: undefined, body: undefined, params: undefined, request: req, ctx: undefined }
}

type RouteCtx = ReturnType<typeof makeCtx>
interface CachedRoute {
  handler: (c: RouteCtx) => Response | Promise<Response>
}

/** `RouteConfig.handler` may return synchronously; every call here is awaited as a promise. */
function call(route: CachedRoute, c: RouteCtx): Promise<Response> {
  return Promise.resolve(route.handler(c))
}

function get(): Request {
  return new Request(URL_UNDER_TEST)
}

/** Engine whose lookups are counted, so the test waits on a condition, not a duration. */
function countingEngine(storage: InMemoryCacheAdapter = new InMemoryCacheAdapter()): {
  engine: CacheEngine
  lookups: () => number
} {
  const inner = createCacheEngine({ storage })
  let resolved = 0
  const engine: CacheEngine = {
    ...inner,
    tryReadCached: async (key, opts) => {
      const result = await inner.tryReadCached(key, opts)
      resolved++
      return result
    },
  }
  return { engine, lookups: () => resolved }
}

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  // A real clock: the stale tests mock Date.now, which would freeze this deadline.
  const deadline = performance.now() + 2000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for: ${what}`)
    await new Promise((r) => setImmediate(r))
  }
  // One more macrotask so every caller resumed past its lookup has reached the handler.
  await new Promise((r) => setImmediate(r))
}

type Outcome = (run: number) => Response

/**
 * A handler that counts entries and holds every call until the current gate opens.
 * `rearm` closes a new gate for the calls that follow; `settled` counts finished runs.
 */
function gatedHandler(outcome: Outcome = (run) => Response.json({ run })): {
  handler: () => Promise<Response>
  entries: () => number
  settled: () => number
  release: () => void
  rearm: (next?: Outcome) => void
} {
  let entered = 0
  let finished = 0
  let current = outcome
  let open!: () => void
  let gate = new Promise<void>((r) => {
    open = r
  })
  return {
    handler: async () => {
      entered++
      const run = entered
      const myGate = gate
      const myOutcome = current
      try {
        await myGate
        return myOutcome(run)
      } finally {
        finished++
      }
    },
    entries: () => entered,
    settled: () => finished,
    release: () => open(),
    rearm: (next) => {
      if (next) current = next
      gate = new Promise<void>((r) => {
        open = r
      })
    },
  }
}

/** Put one entry in place, then move the clock past maxAge so the next reads are stale. */
async function populateThenStale(
  route: CachedRoute,
  gated: ReturnType<typeof gatedHandler>,
): Promise<void> {
  const first = call(route, makeCtx(get()))
  gated.release()
  expect((await first).headers.get('X-Theo-Cache')).toBe('MISS')
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 5_000)
}

describe('defineCachedRoute single-flight (B-667)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('test_concurrent_misses_on_one_key_run_the_handler_once', async () => {
    const { engine, lookups } = countingEngine()
    const gated = gatedHandler()
    const route = defineCachedRoute(engine, { cache: { maxAge: 60 }, handler: gated.handler })

    const pending = Array.from({ length: CONCURRENT_REQUESTS }, () => call(route, makeCtx(get())))
    await waitFor(() => lookups() >= CONCURRENT_REQUESTS, `${CONCURRENT_REQUESTS} cache lookups`)
    const handlerRuns = gated.entries()
    gated.release()
    const responses = await Promise.all(pending)

    expect(handlerRuns, `handler runs for ${CONCURRENT_REQUESTS} concurrent misses`).toBe(1)
    // Every request gets its own Response, and every body is readable: a follower handed the
    // leader's single-use Response would fail here with a used body.
    expect(new Set(responses).size).toBe(CONCURRENT_REQUESTS)
    const bodies = await Promise.all(responses.map((r) => r.json()))
    expect(bodies).toEqual(Array.from({ length: CONCURRENT_REQUESTS }, () => ({ run: 1 })))
    expect(responses.every((r) => r.headers.get('X-Theo-Cache') === 'MISS')).toBe(true)
  })

  it('test_concurrent_stale_hits_on_one_key_start_one_revalidation', async () => {
    const { engine, lookups } = countingEngine()
    const gated = gatedHandler()
    const route = defineCachedRoute(engine, {
      cache: { maxAge: 1, swr: 600 },
      handler: gated.handler,
    })
    await populateThenStale(route, gated)
    gated.rearm() // every revalidation started by the burst is held until the end

    const before = { entries: gated.entries(), lookups: lookups() }
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () => call(route, makeCtx(get()))),
    )
    await waitFor(
      () => lookups() - before.lookups >= CONCURRENT_REQUESTS,
      `${CONCURRENT_REQUESTS} stale lookups`,
    )
    const revalidations = gated.entries() - before.entries
    const settledBefore = gated.settled()
    gated.release()
    await waitFor(() => gated.settled() > settledBefore, 'the held revalidation to settle')

    expect(responses.every((r) => r.headers.get('X-Theo-Cache') === 'STALE')).toBe(true)
    expect(revalidations, `background revalidations for ${CONCURRENT_REQUESTS} stale hits`).toBe(1)
  })

  it('test_followers_of_an_uncacheable_leader_wait_for_it_then_run_the_handler_themselves', async () => {
    const { engine, lookups } = countingEngine()
    const gated = gatedHandler(
      (run) => new Response(`run ${run}`, { headers: { 'set-cookie': `s=${run}` } }),
    )
    const route = defineCachedRoute(engine, { cache: { maxAge: 60 }, handler: gated.handler })

    const pending = Array.from({ length: CONCURRENT_REQUESTS }, () => call(route, makeCtx(get())))
    await waitFor(() => lookups() >= CONCURRENT_REQUESTS, `${CONCURRENT_REQUESTS} cache lookups`)
    const runsWhileLeaderHeld = gated.entries()
    gated.release()
    const responses = await Promise.all(pending)

    // Followers wait for the leader's outcome before running anything.
    expect(runsWhileLeaderHeld, 'handler runs while the leader is still running').toBe(1)
    // The leader's response is not shareable (Set-Cookie): each request ran its own handler,
    // and no cookie crossed requests.
    expect(gated.entries()).toBe(CONCURRENT_REQUESTS)
    const cookies = responses.map((r) => r.headers.get('set-cookie'))
    expect(new Set(cookies).size).toBe(CONCURRENT_REQUESTS)
  })

  it.each([
    {
      flavour: 'an error status',
      cache: {},
      outcome: (run: number) => new Response(`run ${run}`, { status: 500 }),
    },
    {
      flavour: 'a cacheable predicate refusing it',
      cache: { cacheable: () => false },
      outcome: (run: number) => new Response(`run ${run}`),
    },
    {
      flavour: 'an oversized body',
      cache: { maxEntrySize: 1 },
      outcome: (run: number) => new Response(`run ${run}`),
    },
  ])(
    'test_followers_of_a_leader_whose_response_is_uncacheable_by_$flavour_run_the_handler_themselves',
    async ({ cache, outcome }) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { engine, lookups } = countingEngine()
      const gated = gatedHandler(outcome)
      const route = defineCachedRoute(engine, {
        cache: { maxAge: 60, ...cache },
        handler: gated.handler,
      })

      const pending = Array.from({ length: CONCURRENT_REQUESTS }, () => call(route, makeCtx(get())))
      await waitFor(() => lookups() >= CONCURRENT_REQUESTS, `${CONCURRENT_REQUESTS} cache lookups`)
      const runsWhileLeaderHeld = gated.entries()
      gated.release()
      const responses = await Promise.all(pending)

      expect(runsWhileLeaderHeld, 'handler runs while the leader is still running').toBe(1)
      expect(gated.entries()).toBe(CONCURRENT_REQUESTS)
      // No request received another request's response.
      const bodies = await Promise.all(responses.map((r) => r.text()))
      expect(new Set(bodies).size).toBe(CONCURRENT_REQUESTS)
    },
  )

  it('test_a_throwing_leader_rejects_its_followers_and_frees_the_key', async () => {
    const { engine, lookups } = countingEngine()
    const failures: Error[] = []
    const gated = gatedHandler((run) => {
      const err = new Error(`leader failed on run ${run}`)
      failures.push(err)
      throw err
    })
    const route = defineCachedRoute(engine, { cache: { maxAge: 60 }, handler: gated.handler })

    const pending = Array.from({ length: CONCURRENT_REQUESTS }, () =>
      call(route, makeCtx(get())).then(
        () => undefined,
        (err: unknown) => err,
      ),
    )
    await waitFor(() => lookups() >= CONCURRENT_REQUESTS, `${CONCURRENT_REQUESTS} cache lookups`)
    gated.release()
    const errors = await Promise.all(pending)

    expect(gated.entries(), 'handler runs for a throwing leader and its followers').toBe(1)
    expect(failures).toHaveLength(1)
    expect(errors.every((e) => e === failures[0])).toBe(true)

    // The key is free: the next request runs the handler again.
    gated.rearm((run) => Response.json({ run }))
    const next = call(route, makeCtx(get()))
    gated.release()
    const response = await next
    expect(response.status).toBe(200)
    expect(gated.entries()).toBe(2)
  })

  it('test_a_failed_revalidation_frees_the_key_for_the_next_stale_hit', async () => {
    const { engine, lookups } = countingEngine()
    const gated = gatedHandler()
    const route = defineCachedRoute(engine, {
      cache: { maxAge: 1, swr: 600 },
      handler: gated.handler,
    })
    await populateThenStale(route, gated)
    gated.rearm(() => {
      throw new Error('revalidation failed')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    // A burst while the first revalidation is held starts no second one.
    const before = { entries: gated.entries(), lookups: lookups() }
    await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () => call(route, makeCtx(get()))),
    )
    await waitFor(
      () => lookups() - before.lookups >= CONCURRENT_REQUESTS,
      `${CONCURRENT_REQUESTS} stale lookups`,
    )
    expect(gated.entries() - before.entries, 'revalidations during the held one').toBe(1)

    // It throws; once it has settled, the next stale hit starts a new one.
    const settledBefore = gated.settled()
    gated.release()
    await waitFor(() => gated.settled() > settledBefore, 'the failed revalidation to settle')
    gated.rearm((run) => Response.json({ run }))
    const response = await call(route, makeCtx(get()))
    await waitFor(() => gated.entries() - before.entries >= 2, 'a second revalidation')
    gated.release()

    expect(response.headers.get('X-Theo-Cache')).toBe('STALE')
    expect(gated.entries() - before.entries).toBe(2)
  })

  it('test_concurrent_misses_on_two_keys_run_the_handler_once_per_key', async () => {
    const { engine, lookups } = countingEngine()
    let entered = 0
    let open!: () => void
    const gate = new Promise<void>((r) => {
      open = r
    })
    const route = defineCachedRoute(engine, {
      cache: { maxAge: 60 },
      handler: async (c: { request: Request }) => {
        entered++
        await gate
        return Response.json({ path: new URL(c.request.url).pathname })
      },
    })
    const urls = ['https://x/api/a', 'https://x/api/b']
    const pending = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) => {
      const url = urls[i % 2]
      return call(route, makeCtx(new Request(url))).then(async (r) => ({
        url,
        body: await r.json(),
      }))
    })
    await waitFor(() => lookups() >= CONCURRENT_REQUESTS, `${CONCURRENT_REQUESTS} cache lookups`)
    const runs = entered
    open()
    const results = await Promise.all(pending)

    // One run per key, never one per route: a per-route slot would give 1 here and hand
    // /api/a's body to /api/b's requests.
    expect(runs, 'handler runs for concurrent misses on 2 keys').toBe(2)
    expect(results.every((r) => r.body.path === new URL(r.url).pathname)).toBe(true)
  })

  it('test_concurrent_stale_hits_on_two_keys_start_one_revalidation_per_key', async () => {
    const { engine, lookups } = countingEngine()
    let entered = 0
    let finished = 0
    let open: () => void = () => undefined
    let gate: Promise<void> = Promise.resolve()
    const route = defineCachedRoute(engine, {
      cache: { maxAge: 1, swr: 600 },
      handler: async (c: { request: Request }) => {
        entered++
        try {
          await gate
          return Response.json({ path: new URL(c.request.url).pathname })
        } finally {
          finished++
        }
      },
    })
    const urls = ['https://x/api/a', 'https://x/api/b']
    for (const url of urls) await call(route, makeCtx(new Request(url)))
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 5_000)
    gate = new Promise<void>((r) => {
      open = r
    })

    const before = { entries: entered, lookups: lookups() }
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
        call(route, makeCtx(new Request(urls[i % 2]))),
      ),
    )
    await waitFor(
      () => lookups() - before.lookups >= CONCURRENT_REQUESTS,
      `${CONCURRENT_REQUESTS} stale lookups`,
    )
    const revalidations = entered - before.entries
    open()
    await waitFor(() => finished >= entered, 'both held revalidations to settle')

    expect(responses.every((r) => r.headers.get('X-Theo-Cache') === 'STALE')).toBe(true)
    expect(revalidations, 'background revalidations for stale hits on 2 keys').toBe(2)
  })

  it('test_a_leader_aborted_by_its_own_client_lets_followers_run_the_handler', async () => {
    const { engine, lookups } = countingEngine()
    let entered = 0
    let open!: () => void
    const gate = new Promise<void>((r) => {
      open = r
    })
    const route = defineCachedRoute(engine, {
      cache: { maxAge: 60 },
      handler: async (c: { request: Request }) => {
        entered++
        await gate
        if (c.request.signal.aborted) throw new DOMException('client went away', 'AbortError')
        return Response.json({ ok: true })
      },
    })
    const controller = new AbortController()
    const leader = call(
      route,
      makeCtx(new Request(URL_UNDER_TEST, { signal: controller.signal })),
    ).then(
      () => undefined,
      (err: unknown) => err,
    )
    const followers = Array.from({ length: CONCURRENT_REQUESTS - 1 }, () =>
      call(route, makeCtx(get())).then(
        (r) => r.status,
        (err: unknown) => err,
      ),
    )
    await waitFor(() => lookups() >= CONCURRENT_REQUESTS, `${CONCURRENT_REQUESTS} cache lookups`)
    expect(entered, 'handler runs while the leader is held').toBe(1)
    controller.abort()
    open()

    const leaderError = await leader
    expect(leaderError).toBeInstanceOf(DOMException)
    expect((leaderError as DOMException).name).toBe('AbortError')
    // One client going away is not a cause the other requests share.
    const statuses = await Promise.all(followers)
    expect(entered, 'the leader and each follower ran the handler').toBe(CONCURRENT_REQUESTS)
    expect(statuses).toEqual(Array.from({ length: CONCURRENT_REQUESTS - 1 }, () => 200))
  })

  it('test_a_failing_cache_write_under_the_leader_frees_the_key', async () => {
    const writeError = new Error('storage write failed')
    let failNextWrite = true
    class FailingOnceAdapter extends InMemoryCacheAdapter {
      override async set(...args: Parameters<InMemoryCacheAdapter['set']>): Promise<void> {
        if (failNextWrite) {
          failNextWrite = false
          throw writeError
        }
        return super.set(...args)
      }
    }
    const { engine, lookups } = countingEngine(new FailingOnceAdapter())
    const gated = gatedHandler()
    const route = defineCachedRoute(engine, { cache: { maxAge: 60 }, handler: gated.handler })

    const pending = Array.from({ length: CONCURRENT_REQUESTS }, () =>
      call(route, makeCtx(get())).then(
        () => undefined,
        (err: unknown) => err,
      ),
    )
    await waitFor(() => lookups() >= CONCURRENT_REQUESTS, `${CONCURRENT_REQUESTS} cache lookups`)
    gated.release()
    const errors = await Promise.all(pending)

    expect(gated.entries(), 'handler runs under a failing cache write').toBe(1)
    expect(errors.every((e) => e === writeError)).toBe(true)

    // The key is free: the next request runs the handler and its write succeeds.
    gated.rearm()
    const next = call(route, makeCtx(get()))
    gated.release()
    const response = await next
    expect(response.headers.get('X-Theo-Cache')).toBe('MISS')
    expect(gated.entries()).toBe(2)
  })

  it('test_an_uncacheable_revalidation_frees_the_key_for_the_next_stale_hit', async () => {
    const { engine } = countingEngine()
    const gated = gatedHandler()
    const route = defineCachedRoute(engine, {
      cache: { maxAge: 1, swr: 600 },
      handler: gated.handler,
    })
    await populateThenStale(route, gated)
    // The revalidation returns Set-Cookie, so it writes nothing (the early return).
    gated.rearm((run) => new Response(`run ${run}`, { headers: { 'set-cookie': `s=${run}` } }))

    const before = { entries: gated.entries(), settled: gated.settled() }
    const first = await call(route, makeCtx(get()))
    await waitFor(() => gated.entries() - before.entries >= 1, 'the first revalidation')
    gated.release()
    await waitFor(() => gated.settled() > before.settled, 'the uncacheable revalidation to settle')

    gated.rearm((run) => new Response(`run ${run}`, { headers: { 'set-cookie': `s=${run}` } }))
    const second = await call(route, makeCtx(get()))
    await waitFor(() => gated.entries() - before.entries >= 2, 'a second revalidation')
    gated.release()
    await waitFor(() => gated.settled() - before.settled >= 2, 'the second revalidation to settle')

    expect(first.headers.get('X-Theo-Cache')).toBe('STALE')
    expect(second.headers.get('X-Theo-Cache')).toBe('STALE')
    expect(gated.entries() - before.entries, 'revalidations across two stale hits').toBe(2)
  })

  it('test_a_lone_throwing_leader_rejects_without_an_unhandled_rejection', async () => {
    const { engine } = countingEngine()
    const failure = new Error('lone leader failed')
    const gated = gatedHandler(() => {
      throw failure
    })
    const route = defineCachedRoute(engine, { cache: { maxAge: 60 }, handler: gated.handler })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const lone = call(route, makeCtx(get()))
      gated.release()
      await expect(lone).rejects.toBe(failure)
      // Node reports an unhandled rejection once the microtask queue drains, before the
      // next macrotask runs, so one setImmediate is past the point it would have fired.
      await new Promise((r) => setImmediate(r))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(unhandled, 'unhandled rejections from a leader with no follower').toEqual([])
    // The key is free: the next request runs the handler again.
    gated.rearm((run) => Response.json({ run }))
    const next = call(route, makeCtx(get()))
    gated.release()
    expect((await next).status).toBe(200)
    expect(gated.entries()).toBe(2)
  })

  it('test_a_failed_revalidation_reports_its_error', async () => {
    const { engine } = countingEngine()
    const gated = gatedHandler()
    const route = defineCachedRoute(engine, {
      cache: { maxAge: 1, swr: 600 },
      handler: gated.handler,
    })
    await populateThenStale(route, gated)
    const failure = new Error('revalidation failed')
    gated.rearm(() => {
      throw failure
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const stale = await call(route, makeCtx(get()))
    gated.release()
    await waitFor(() => warn.mock.calls.length > 0, 'the failed revalidation to be reported')

    expect(stale.headers.get('X-Theo-Cache')).toBe('STALE')
    expect(warn).toHaveBeenCalledTimes(1)
    const [message, reported] = warn.mock.calls[0] ?? []
    expect(String(message)).toContain('background revalidation failed')
    expect(String(message)).toContain('GET /api/single-flight')
    expect(reported).toBe(failure)
  })

  it('test_a_failed_revalidation_warning_omits_query_and_varied_header_values', async () => {
    const { engine } = countingEngine()
    const gated = gatedHandler()
    const route = defineCachedRoute(engine, {
      cache: { maxAge: 1, swr: 600, varies: ['authorization'] },
      handler: gated.handler,
    })
    const secretRequest = (): Request =>
      new Request(`${URL_UNDER_TEST}?token=query-secret`, {
        headers: { authorization: 'Bearer header-secret' },
      })
    const first = call(route, makeCtx(secretRequest()))
    gated.release()
    expect((await first).headers.get('X-Theo-Cache')).toBe('MISS')
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000)
    gated.rearm(() => {
      throw new Error('revalidation failed')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const stale = await call(route, makeCtx(secretRequest()))
    gated.release()
    await waitFor(() => warn.mock.calls.length > 0, 'the failed revalidation to be reported')

    expect(stale.headers.get('X-Theo-Cache')).toBe('STALE')
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('GET /api/single-flight')
    expect(message).not.toContain('query-secret')
    expect(message).not.toContain('header-secret')
  })

  it('test_a_route_whose_revalidation_keeps_failing_warns_once', async () => {
    const { engine } = countingEngine()
    const gated = gatedHandler()
    const route = defineCachedRoute(engine, {
      cache: { maxAge: 1, swr: 600 },
      handler: gated.handler,
    })
    await populateThenStale(route, gated)
    gated.rearm(() => {
      throw new Error('revalidation failed')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    for (let failure = 1; failure <= 2; failure++) {
      const entriesBefore = gated.entries()
      const settledBefore = gated.settled()
      expect((await call(route, makeCtx(get()))).headers.get('X-Theo-Cache')).toBe('STALE')
      await waitFor(() => gated.entries() > entriesBefore, `revalidation ${failure} to start`)
      gated.release()
      await waitFor(() => gated.settled() > settledBefore, `revalidation ${failure} to settle`)
      gated.rearm()
    }

    expect(gated.settled(), 'failed background revalidations').toBeGreaterThanOrEqual(3)
    expect(warn, 'warnings for one route whose revalidation failed twice').toHaveBeenCalledTimes(1)
  })
})
