import { describe, expect, it } from 'vitest'

import type { MiddlewareNext } from '../../packages/theo/src/server/define/define-middleware.js'
import { middleware } from '../../packages/theo/src/server/define/middleware-builder.js'
import { runWebMiddleware } from '../../packages/theo/src/server/http/web-middleware-runner.js'

/**
 * B-003 / T1.1 — the boundary between the PUBLIC builder and the runner that
 * actually executes middleware for a Web request.
 *
 * Neither side alone is the subject. `middleware()` is tested elsewhere against
 * its own output, and `runWebMiddleware` is tested elsewhere against hand-written
 * functions; what nothing exercised is a handler authored through the public
 * builder being run by the real runner. FR-001 and FR-004.
 *
 * Every case here turns on `next` — the parameter the runner does not pass today,
 * which is why this file is RED until T1.2. The contract each case pins is
 * `docs/adr/0006-the-web-runner-calls-next-for-a-void-middleware.md`, and the
 * clause numbers below are that ADR's.
 *
 * The three cases are not redundant. Each refutes a DIFFERENT wrong reading of
 * clause 6, and each wrong reading survived at least one panel round:
 *
 *   round 3 — the runner re-invokes the downstream for a middleware that awaited
 *             `next`, so it runs twice. Caught by the counter.
 *   round 4 — the frame yields the middleware's own void return, so the route's
 *             `Response` is dropped and the reply is empty. The counter reads 1
 *             under this reading too, so ONLY the identity assertion sees it.
 *   round 5 — the frame always yields the downstream's result, so a middleware
 *             that awaits `next` and returns its own `Response` has it silently
 *             discarded. Caught by the third case and by nothing else.
 */

/**
 * Narrow `next` to something callable, failing by name when it is not.
 *
 * `next` is OPTIONAL in the type (clause 5, so two-parameter middleware keeps
 * compiling), which means `tsc` refuses a bare `next()`. The two shortcuts that
 * silence it are both wrong here: `next!()` hides the contract behind an
 * assertion, and `next?.()` FAILS OPEN — a runner that stopped passing `next`
 * would make the middleware quietly do nothing, which is the defect this file
 * exists to catch wearing a passing test.
 */
function callable(next: MiddlewareNext | undefined): MiddlewareNext {
  if (typeof next !== 'function') {
    throw new TypeError('runWebMiddleware passed no callable `next` — docs/adr/0006 clause 3')
  }
  return next
}

/**
 * A downstream that counts its invocations and hands back a DISTINCT `Response` per call.
 *
 * `response` is the first one, so single-invocation cases read as before. What changed on
 * re-review: it used to return ONE stable object, and an identity assertion over it could not
 * see WHICH invocation the frame yielded. A reviewer armed `settled[0]` — yield the first
 * rather than the last — and all sixteen tests passed. The fixture was erasing the difference
 * the assertion claimed to measure, which is this item's own subject inside its own test.
 */
function countingDownstream(trace: string[] = []) {
  const responses: Response[] = []
  let calls = 0
  return {
    get response() {
      return responses[0]
    },
    nth: (index: number) => responses[index],
    calls: () => calls,
    run: async () => {
      calls += 1
      trace.push('route')
      const made = new Response(`from the route, invocation ${calls}`)
      responses.push(made)
      return made
    },
  }
}

describe('the public builder runs in the Web runner (B-003)', () => {
  it('test_a_middleware_that_awaits_next_and_returns_void_yields_the_downstream_response', async () => {
    const seen: string[] = []
    const downstream = countingDownstream(seen)

    const handler = middleware()
      .handle(async (_request, _context, next) => {
        seen.push('before')
        await callable(next)()
        seen.push('after')
      })
      .build()

    const result = await runWebMiddleware(new Request('http://x/'), [handler], {}, downstream.run)

    // Clause 2 + clause 6, first assertion: the downstream ran, and ran ONCE.
    // Without clause 6 the runner invokes it again on the middleware's behalf
    // after the middleware already awaited it — the round-3 defect.
    expect(downstream.calls(), 'the downstream ran exactly once').toBe(1)

    // Clause 6, second assertion. The counter above reads 1 whether the frame
    // yields the route's `Response` or the middleware's `undefined`, so the
    // counter alone cannot see the round-4 defect. Identity can.
    expect(result, "the frame yields the downstream's own Response").toBe(downstream.response)

    // THE assertion that makes this case non-vacuous, and it was not here first.
    //
    // Running the plan's own AC-002 canary — delete the `next()` call and watch
    // the suite go red — left all three cases GREEN. Clause 2 explains why: a
    // middleware that returns void WITHOUT calling `next` still has the runner
    // run the rest of the chain on its behalf, so the counter still reads 1, the
    // frame still yields the route's `Response`, and `['before', 'after']` is
    // still the trace. Every assertion above holds under a middleware that never
    // touched `next`.
    //
    // What separates the two is WHEN the route ran. Awaiting `next` puts it
    // BETWEEN the two marks; the runner continuing on the middleware's behalf
    // puts it after them.
    expect(seen, 'the route ran INSIDE the middleware, not after it').toEqual([
      'before',
      'route',
      'after',
    ])
  })

  it('test_a_middleware_that_calls_next_without_awaiting_still_invokes_the_downstream_once', async () => {
    const downstream = countingDownstream()

    const handler = middleware()
      .handle((_request, _context, next) => {
        void callable(next)()
      })
      .build()

    const result = await runWebMiddleware(new Request('http://x/'), [handler], {}, downstream.run)

    // Clause 7: "has invoked" is call-time, not completion-time. A flag written
    // after an await reads false here, and the runner invokes the downstream a
    // second time.
    expect(downstream.calls(), 'calling next without awaiting still counts as invoking').toBe(1)

    // Clause 6 yields what the INVOCATION produced, awaited by the runner. A
    // frame that reads a slot holding the settled VALUE finds it empty here and
    // serves a blank page — the round-4 defect, restored through clause 7's door.
    expect(result, 'the runner awaits what next() started').toBe(downstream.response)
  })

  it('test_a_middleware_that_awaits_next_and_returns_its_own_response_wins_over_the_downstream', async () => {
    const downstream = countingDownstream()
    const own = new Response('from the middleware')

    const handler = middleware()
      .handle(async (_request, _context, next) => {
        await callable(next)()
        return own
      })
      .build()

    const result = await runWebMiddleware(new Request('http://x/'), [handler], {}, downstream.run)

    expect(downstream.calls(), 'the downstream still ran exactly once').toBe(1)

    // Clause 6's precedence, and the capability clause 3 exists for. Without the
    // order being stated, the frame yields the downstream's `Response`, the route
    // is still served, and the middleware appears to work while its contribution
    // is dropped — which is why this must be identity against `own` and not merely
    // "a Response came back".
    expect(result, "the middleware's own Response wins").toBe(own)
    expect(result, "and it is not the downstream's").not.toBe(downstream.response)
  })

  it('test_calling_next_twice_really_invokes_the_downstream_twice', async () => {
    const downstream = countingDownstream()

    const handler = middleware()
      .handle(async (_request, _context, next) => {
        const first = callable(next)()
        const second = callable(next)()
        await Promise.allSettled([first, second])
      })
      .build()

    const result = await runWebMiddleware(new Request('http://x/'), [handler], {}, downstream.run)

    // ADR 0006 clause 7 rejects memoising `next`'s result BY NAME, on the ground that
    // memoising "would also silence a genuinely careless double call, which is the one thing
    // the counter in AC-003 exists to detect".
    //
    // Nothing tested it. A reviewer armed the rejected reading — `pending ??= runFrom(index+1)`
    // — and nothing failed, because no test called `next()` twice. (This said "ran the WHOLE
    // repository suite: 8075 passed". His record is one test file and he said so in writing;
    // the denominator was the author's invention and he caught it on the third review.) The ADR and the runner's own docblock both named a
    // protection that did not exist, which is the defect class this entire item is about.
    expect(downstream.calls(), 'a second next() is a second invocation, never a cached one').toBe(2)

    // Clause 6 yields what the LAST invocation produced, and the fixture now hands back a
    // distinct object per call so the assertion can tell them apart. Against the previous
    // fixture — one stable `Response` — yielding the FIRST invocation passed just as well.
    expect(downstream.nth(1), 'the fixture must distinguish the two invocations').not.toBe(
      downstream.nth(0),
    )
    expect(result, 'the frame yields what the LAST invocation produced').toBe(downstream.nth(1))
  })

  it('test_a_discarded_invocation_is_reported_and_never_orphaned', async () => {
    const orphaned: unknown[] = []
    const onUnhandled = (reason: unknown) => orphaned.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const warned: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warned.push(args.join(' '))
    }

    const exploding = async () => {
      throw new Error('the route handler blew up')
    }
    const own = new Response('served from cache', { status: 200 })
    const handler = middleware()
      .handle(async (_request, _context, next) => {
        void callable(next)()
        // A MACROTASK between the call and the return. This is the shape the first fix missed:
        // owning the invocations after the body returns leaves the promise unowned for as long
        // as the body runs, and a cache lookup is exactly this. Node declares the rejection
        // unhandled at end of tick and the process dies mid-request — worse than the original
        // defect, where the client at least received its response first.
        await new Promise((resolve) => setTimeout(resolve, 10))
        return own
      })
      .build()

    const result = await runWebMiddleware(new Request('http://x/'), [handler], {}, exploding)

    await new Promise((resolve) => setTimeout(resolve, 20))
    console.warn = realWarn
    process.off('unhandledRejection', onUnhandled)

    // Clause 6 is unchanged: the middleware's own `Response` wins. A middleware that discarded
    // this invocation's value has already declared it does not want that outcome, and
    // overturning it would be a second decision rather than a consequence of owning the
    // rejection. `rules/error-handling.md § 2` forbids SWALLOWING an error; it does not require
    // that every error become the request's answer.
    expect(result, "clause 6 still yields the middleware's own Response").toBe(own)

    expect(orphaned, 'a discarded invocation left its rejection unowned').toEqual([])

    // Not swallowed — reported, through the convention this package already uses for a failure
    // it cannot return (`server/index.ts:50`, `jobs/job-backend-memory.ts:77`).
    expect(
      warned.filter((w) => w.includes('the route handler blew up')),
      'the discarded failure reached no client AND was not reported anywhere',
    ).toHaveLength(1)
  })

  it('test_a_late_rejection_is_still_reported', async () => {
    const warned: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warned.push(args.join(' '))
    }
    const orphaned: unknown[] = []
    const onUnhandled = (reason: unknown) => orphaned.push(reason)
    process.on('unhandledRejection', onUnhandled)

    // The route fails AFTER the frame has already chosen. This is the archetype every artifact
    // uses for this feature — a middleware answering from cache — and the first fix swallowed
    // it: the rejection was recorded into a per-frame map the frame never reads again, so the
    // failure reached nobody at all. Zero warnings, which is what `error-handling.md § 2`
    // forbids and what the reporting exists to prevent.
    const lateBoom = async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      throw new Error('the route failed after the frame had answered')
    }
    const handler = middleware()
      .handle((_request, _context, next) => {
        void callable(next)()
        return new Response('served from cache', { status: 200 })
      })
      .build()

    const result = await runWebMiddleware(new Request('http://x/'), [handler], {}, lateBoom)
    await new Promise((resolve) => setTimeout(resolve, 60))
    console.warn = realWarn
    process.off('unhandledRejection', onUnhandled)

    expect(await result?.text(), 'clause 6 still yields the cached response').toBe(
      'served from cache',
    )
    expect(orphaned, 'a late rejection was left unowned').toEqual([])
    expect(
      warned.filter((w) => w.includes('failed after the frame had answered')),
      'a rejection landing after the frame returned reached nobody',
    ).toHaveLength(1)
  })

  // The two cases below use a DEFERRED downstream rather than a sleep. The rejection is fired by
  // the test and awaited by the test, so the assertion waits exactly as long as the effect takes
  // and never races it -- which is the shape the audit's finding on wall-clock synchronisation
  // asks the older cases to adopt.
  it('test_a_middleware_that_throws_after_firing_next_still_reports_the_downstream_failure', async () => {
    const warned: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warned.push(args.join(' '))
    }
    const orphaned: unknown[] = []
    const onUnhandled = (reason: unknown) => orphaned.push(reason)
    process.on('unhandledRejection', onUnhandled)

    // The downstream never settles on its own: the TEST decides when it fails, so nothing here
    // depends on a clock.
    let failDownstream!: (reason: unknown) => void
    let settled!: Promise<unknown>
    const deferredDownstream = async () => {
      settled = new Promise((_resolve, reject) => {
        failDownstream = reject
      })
      return settled as Promise<Response>
    }

    const OWN = new Error('the middleware rejected the request itself')
    const DOWNSTREAM = new Error('the route failed for its own unrelated reason')
    const handler = middleware()
      .handle((_request, _context, next) => {
        void callable(next)()
        throw OWN
      })
      .build()

    try {
      await runWebMiddleware(new Request('http://x/'), [handler], {}, deferredDownstream)
      expect.unreachable('the middleware threw, so the frame must reject')
    } catch (error) {
      expect(error, "the caller holds the MIDDLEWARE's error, not the downstream's").toBe(OWN)
    }

    // Two DIFFERENT failures: the caller is holding OWN and knows nothing about DOWNSTREAM. That
    // is what makes reporting it a report rather than a duplicate -- proved by identity, not by
    // resemblance.
    failDownstream(DOWNSTREAM)
    await settled.catch(() => undefined)
    await Promise.resolve()

    console.warn = realWarn
    process.off('unhandledRejection', onUnhandled)

    expect(orphaned, 'the downstream rejection was left unowned').toEqual([])
    expect(
      warned.filter((w) => w.includes('unrelated reason')),
      'the middleware threw after firing next(), and the downstream failure reached nobody',
    ).toHaveLength(1)
  })

  it('test_a_rejection_the_caller_is_already_holding_is_not_reported_twice', async () => {
    // The guard on the case above. `await next()` propagates the downstream's rejection object
    // UNCHANGED, so the caller ends up holding the very error a naive fix would also report --
    // which is the regression this file's runner docblock records as having shipped once.
    const warned: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warned.push(args.join(' '))
    }

    const DOWNSTREAM = new Error('the route failed and the middleware did not catch it')
    const boom = async (): Promise<Response> => {
      throw DOWNSTREAM
    }
    const handler = middleware()
      .handle(async (_request, _context, next) => {
        await callable(next)()
      })
      .build()

    await expect(runWebMiddleware(new Request('http://x/'), [handler], {}, boom)).rejects.toBe(
      DOWNSTREAM,
    )

    console.warn = realWarn

    expect(
      warned.filter((w) => w.includes('did not catch it')),
      'the error the caller is already holding was reported a second time',
    ).toHaveLength(0)
  })

  it('test_the_yielded_rejection_is_not_reported_twice', async () => {
    const warned: string[] = []
    const realWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warned.push(args.join(' '))
    }

    // The shape where the guard is REACHABLE, which is not the one this case first used.
    //
    // It used the canonical wrap — `await next()` — and a canary showed deleting the guard left
    // the suite green there. Structural, not luck: a middleware that awaits a rejecting `next()`
    // THROWS, so the frame never reaches `report` and no guard is consulted. The guard exists
    // for clause 6 branch 2: `next()` fired without awaiting, the middleware returns void, and
    // the FRAME awaits the invocation — so the rejection travels to the caller through the
    // frame's own return, and reporting it would be a second copy of an error being held.
    const boom = async () => {
      throw new Error('the route handler blew up')
    }
    const handler = middleware()
      .handle((_request, _context, next) => {
        void callable(next)()
      })
      .build()

    await expect(runWebMiddleware(new Request('http://x/'), [handler], {}, boom)).rejects.toThrow(
      'the route handler blew up',
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    console.warn = realWarn

    expect(
      warned.filter((w) => w.includes('blew up')),
      'the rejection the caller is holding was reported again',
    ).toHaveLength(0)
  })
})
