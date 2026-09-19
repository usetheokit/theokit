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

/** A downstream that counts its invocations and hands back one stable `Response`. */
function countingDownstream(trace: string[] = []) {
  const response = new Response('from the route')
  let calls = 0
  return {
    response,
    calls: () => calls,
    run: async () => {
      calls += 1
      trace.push('route')
      return response
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
    // — and ran the WHOLE repository suite: 8075 passed, byte-identical to baseline, because
    // no test called `next()` twice. The ADR and the runner's own docblock both named a
    // protection that did not exist, which is the defect class this entire item is about.
    expect(downstream.calls(), 'a second next() is a second invocation, never a cached one').toBe(2)

    // And the frame still yields a Response — the last invocation's, per clause 6.
    expect(result, 'the frame yields what the last invocation produced').toBe(downstream.response)
  })

  it('test_a_discarded_invocation_does_not_orphan_its_rejection', async () => {
    const failures: unknown[] = []
    const onUnhandled = (reason: unknown) => failures.push(reason)
    process.on('unhandledRejection', onUnhandled)

    const exploding = async () => {
      throw new Error('the route handler blew up')
    }
    const handler = middleware()
      .handle((_request, _context, next) => {
        void callable(next)()
        return new Response('served from cache', { status: 200 })
      })
      .build()

    // Clause 6 would prefer the middleware's own `Response`. An exception is not a value, and
    // `rules/error-handling.md § 2` forbids swallowing one — so the failure propagates rather
    // than being discarded with the value.
    //
    // Measured 2026-09-19 before the fix, through `executeWebRequest` with this exact shape:
    // the client received 200 and the SERVER PROCESS DIED on the unhandled rejection, with
    // nothing connecting the crash to the request. Impossible before this contract, because
    // every result passed through one `await` into the caller's try/catch.
    await expect(
      runWebMiddleware(new Request('http://x/'), [handler], {}, exploding),
    ).rejects.toThrow('the route handler blew up')

    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', onUnhandled)

    expect(failures, 'an invocation the frame discarded left its rejection unowned').toEqual([])
  })
})
