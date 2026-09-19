/**
 * T3.2 — Web-Standards middleware runner for the `executeWebRequest` path.
 *
 * The Node request path (`http/execute.ts`) runs middleware via
 * `runMiddlewareAndContext`, which is coupled to Node `req`/`res`. Per G8
 * (Web Standards over Node APIs) the Web path needs a `Request`-shaped runner;
 * this is it. Extracted to a sibling so `web-handler.ts` stays under its LoC
 * budget (G6).
 *
 * Ordering invariant (EC-3): the caller runs the CSRF gate BEFORE invoking this
 * runner, mirroring the Node path (CSRF stage precedes user middleware).
 *
 * NOTE (D4 / EC-12): this is its own middleware contract — `(request, context)`.
 * Full semantic parity with the Node `defineMiddleware` contract is part of the
 * deferred Node→Web pipeline convergence, not this slice.
 */

import type { MiddlewareNext } from '../define/define-middleware.js'

/**
 * Run the rest of the chain and resolve to what it produced.
 *
 * An ALIAS, not a second declaration. The two lived as separate structurally
 * identical types before this change and were measured on 2026-09-19 to be
 * incompatible the moment either moved — `MiddlewareHandler` admits
 * `Promise<void>` and `WebMiddleware` did not, so the builder's output was not
 * assignable to the runner's parameter and `tsc` said so in SEVERAL errors that no
 * test could see. (This said "15" until review: control gives 0, an isolated revert 3, a full
 * revert 14, and no reconstruction gives 15 — it was measured on an uncommitted tree and
 * published as a measurement. The mechanism holds; the figure did not, and a figure in a code
 * comment outlives the CHANGELOG entry that carried the same one.) Two names for one contract is how that happens.
 */
export type WebNext = MiddlewareNext

/**
 * A Web-path middleware: mutate `context`, return a `Response`, or call `next`.
 *
 * `next` is OPTIONAL in the parameter list so every middleware written against
 * the two-parameter shape keeps compiling and keeps behaving identically — see
 * `docs/adr/0006` clause 5, which rests that claim on a measured call site
 * rather than on confidence.
 */
export type WebMiddleware = (
  request: Request,
  context: Record<string, unknown>,
  next?: WebNext,
  // A middleware may mutate `context` and return nothing (void) OR return a
  // `Response`. `void` in this union is intentional — the runner only inspects
  // `instanceof Response`, so a void return means "continue".
  //
  // `Promise<... | void>` rather than `Promise<Response | undefined>`: an async
  // middleware that returns nothing has type `Promise<void>`, which the narrower
  // union rejected. That is what made `MiddlewareHandler` unassignable here.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
) => Response | undefined | void | Promise<Response | undefined | void>

/** What runs after the last middleware — the route handler, when the caller passes one. */
export type WebDownstream = (
  request: Request,
  context: Record<string, unknown>,
) => Promise<Response | undefined> | Response | undefined

/**
 * Run middleware in order against a shared mutable `context`, composed right to
 * left so each frame can wrap the rest of the chain.
 *
 * What a frame yields is ONE rule with an explicit order (`docs/adr/0006`,
 * clause 6), and the order is the whole contract:
 *
 *   1. the middleware's own `Response`, when it returned one — short-circuit
 *      (clause 1) and wrap-then-replace (clause 3) are the same branch;
 *   2. otherwise, when the middleware called `next`, what THAT invocation
 *      produced — awaited here, so a middleware that called `next` without
 *      awaiting it still yields the downstream's `Response` rather than a blank
 *      page;
 *   3. otherwise the rest of the chain, run on the middleware's behalf
 *      (clause 2 — the unchanged behaviour of every existing middleware).
 *
 * The invocations list being non-empty IS "has invoked" (clause 7). An entry is pushed
 * synchronously by the call, before anything inside `next` awaits, so a middleware that does
 * not await still counts as having invoked. One list, not a boolean kept in step with it.
 *
 * A SECOND `next()` really does invoke the downstream again — retaining is not memoising.
 * Silencing a careless double call would blind the invocation counter that exists to catch it,
 * and `test_calling_next_twice_really_invokes_the_downstream_twice` is what proves that: a
 * reviewer armed the memoising reading and the whole 8075-test suite passed unchanged, because
 * nothing called `next()` twice.
 *
 * EVERY invocation is owned at creation, and only ONE is yielded. A discarded invocation can
 * still reject, and a rejection nobody observes kills the process; it is reported through
 * `console.warn` rather than swallowed, and it does NOT overturn the value clause 6 chose.
 *
 * `downstream` is optional and last: omitted, the runner returns `undefined`
 * when the chain falls through, exactly as before.
 */
export async function runWebMiddleware(
  request: Request,
  middleware: readonly WebMiddleware[],
  context: Record<string, unknown>,
  downstream?: WebDownstream,
): Promise<Response | undefined> {
  const runFrom = async (index: number): Promise<Response | undefined> => {
    if (index >= middleware.length) {
      return downstream === undefined ? undefined : await downstream(request, context)
    }

    // Every invocation this frame creates, in order. A frame yields ONE of them (clause 6)
    // and must still OWN the rest: an invocation whose value is discarded can still reject,
    // and a rejected promise nobody awaits terminates the Node process
    // (`in-process-transport-abort.test.ts:172` records the same fact one package over).
    const invocations: Promise<Response | undefined>[] = []

    const next: WebNext = () => {
      const started = runFrom(index + 1)
      invocations.push(started)

      // Owned AT CREATION, synchronously, and not after the middleware body returns.
      //
      // The first attempt at this awaited the invocations after `await middleware[index](...)`,
      // which leaves the promise unowned for as long as the middleware body runs. A body that
      // awaits a MACROTASK — a cache lookup is one — lets Node declare the rejection unhandled
      // at end of tick, and the process dies mid-request, so the client gets nothing where
      // before it at least got its response. Found on re-review; the fix had closed the shape
      // its own new test exercised rather than the shape the finding described.
      started.catch((reason: unknown) => {
        // NOT swallowed — reported. `rules/error-handling.md § 2` forbids a silent catch, and
        // § 3 is satisfied by a failure that is loud and carries its context. What it does NOT
        // require is that every error become the request's answer: a middleware that discarded
        // this invocation's value has already declared it does not want that outcome, and
        // overturning a `Response` clause 6 says wins would be a second decision rather than a
        // consequence of the first.
        //
        // `console.warn` with this prefix is the convention this package already uses for a
        // failure it cannot return — `server/index.ts:50`, `jobs/job-backend-memory.ts:77`,
        // `agent/configure-agent-registry.ts:62`.
        const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
        console.warn(
          '[theokit] a middleware invoked next() and the downstream rejected, but the frame ' +
            `yielded a different value, so this failure reached no client: ${detail}`,
        )
      })

      return started
    }

    const own = await middleware[index](request, context, next)

    // Clause 6, unchanged: the middleware's own `Response`, otherwise what the invocation
    // produced, otherwise the rest of the chain. The early return stays FIRST — awaiting the
    // discarded invocation before it made a short-circuit block on work it had chosen not to
    // use, measured on re-review at 12ms -> 311ms against a 300ms route.
    if (own instanceof Response) return own
    if (invocations.length > 0) return await invocations[invocations.length - 1]
    return await runFrom(index + 1)
  }

  return runFrom(0)
}
