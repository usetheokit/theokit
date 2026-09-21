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
  next: WebNext,
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
 * reviewer armed the memoising reading and nothing failed, because nothing called `next()`
 * twice. (This said "the whole 8075-test suite". His record is one test file, and he said in
 * writing that he did not run the suite — an attribution the author invented and he caught.)
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
    //: Rejections observed but not yet accounted for. OWNING and REPORTING are separate acts,
    //: and conflating them was this frame's third defect: ownership must be synchronous at
    //: creation, or the process dies while the middleware body runs; reporting can only be
    //: honest once the frame knows which invocation it used and whether it is throwing.
    const rejections = new Map<Promise<Response | undefined>, unknown>()
    //: Set when the frame chooses, so a rejection landing AFTER that is reported at once
    //: rather than recorded into a map the frame will never read again.
    let frameSettled = false
    let yieldedInvocation: Promise<Response | undefined> | undefined

    const next: WebNext = () => {
      const started = runFrom(index + 1)
      invocations.push(started)

      // Owned AT CREATION, synchronously, and not after the middleware body returns.
      //
      // The first attempt awaited the invocations after `await middleware[index](...)`, which
      // leaves the promise unowned for as long as the body runs. A body that awaits a MACROTASK
      // — a cache lookup is one — lets Node declare the rejection unhandled at end of tick, and
      // the process dies mid-request, so the client gets nothing where before it at least got
      // its response. A body that THROWS after calling `next()` never reaches the frame's tail
      // at all, which is why no ownership placed after the body can cover it.
      //
      // Recording OR reporting, depending on whether the frame has finished — see `report`.
      //
      // A rejection can land after the frame returned, and the first version of this recorded
      // it into a map nobody reads again. Measured: a route throwing 50ms after a middleware
      // answered from cache produced ZERO warnings — swallowed, which is what
      // `rules/error-handling.md § 2` forbids and what the reporting exists to prevent. The
      // archetype every artifact uses for this feature is that exact middleware.
      started.catch((reason: unknown) => {
        if (frameSettled) {
          reportOne(started, reason)
          return
        }
        rejections.set(started, reason)
      })

      return started
    }

    /**
     * Report the rejections nobody downstream is holding.
     *
     * `rules/error-handling.md § 2` forbids SWALLOWING an error; it does not require that every
     * error become the request's answer. A middleware that discarded an invocation's value has
     * already declared it does not want that outcome, so clause 6 keeps its value — and the
     * failure still has to be visible somewhere, which is here.
     *
     * `yielded` is the invocation whose rejection reaches the caller, so it is skipped: the
     * first version of this reported EVERY rejecting invocation and asserted, on
     * `const r = await next()` — the canonical wrap and the capability this item exists to add —
     * that "the frame yielded a different value, so this failure reached no client", while the
     * client was holding exactly that error as a 500. A wrong sentence, per request, with a full
     * stack, from a library, with no level and no off switch.
     *
     * `console.warn` with this prefix is what this package already uses for a failure it cannot
     * return — `packages/theo/src/server/index.ts:50`,
     * `packages/theo/src/server/jobs/job-backend-memory.ts:77`,
     * `packages/theo/src/server/agent/configure-agent-registry.ts:62`. Full paths because the
     * short forms resolved from no root that also resolved the first.
     */
    const reportOne = (invocation: Promise<Response | undefined>, reason: unknown): void => {
      if (invocation === yieldedInvocation) return
      const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
      console.warn(
        '[theokit] a middleware invoked next() and the downstream rejected, but the frame ' +
          `did not yield that result, so this failure reached no client: ${detail}`,
      )
    }

    const report = (yielded?: Promise<Response | undefined>): void => {
      yieldedInvocation = yielded
      frameSettled = true
      for (const [invocation, reason] of rejections) reportOne(invocation, reason)
    }

    // The catch exists for ONE fact the earlier version got half right: when the middleware
    // throws, the caller holds an error — but not necessarily THE error a pending invocation
    // failed with, and the two cases are told apart by identity rather than by resemblance.
    //
    //   `await next()` and do not catch  -> the object the caller receives IS the downstream's
    //                                       rejection reason. Reporting it is a duplicate, and
    //                                       the duplicate is the regression `reportOne`'s
    //                                       docblock records as having shipped once.
    //   fire `next()`, then throw        -> the caller receives a DIFFERENT object and never
    //                                       learns the downstream also failed. Measured before
    //                                       this branch existed: `reported=0`.
    //
    // So the held invocation is handed to `report` as the yielded one — reusing the mechanism
    // the frame already has for "the caller is holding this one" instead of adding a second rule
    // beside it — and the rest are reported. The error is rethrown unchanged.
    // DERIVED from the contract declared above, never a second spelling of its union:
    // `WebMiddleware` admits `void` so that an async middleware returning nothing stays
    // assignable, and a hand-written `Response | undefined` here dropped exactly that
    // member — `tsc` caught it at line 207 rather than any test.
    let own: Awaited<ReturnType<WebMiddleware>>
    try {
      own = await middleware[index](request, context, next)
    } catch (error) {
      let held: Promise<Response | undefined> | undefined
      for (const [invocation, reason] of rejections) {
        if (reason === error) held = invocation
      }
      report(held)
      throw error
    }

    // Clause 6, unchanged: the middleware's own `Response`, otherwise what the invocation
    // produced, otherwise the rest of the chain. The early return stays FIRST — awaiting the
    // discarded invocation before it made a short-circuit block on work it had chosen not to
    // use, measured on re-review at 1ms against 301ms on a 300ms route.
    if (own instanceof Response) {
      report()
      return own
    }
    if (invocations.length > 0) {
      const yielded = invocations[invocations.length - 1]
      try {
        return await yielded
      } finally {
        report(yielded)
      }
    }
    report()
    return await runFrom(index + 1)
  }

  return runFrom(0)
}
