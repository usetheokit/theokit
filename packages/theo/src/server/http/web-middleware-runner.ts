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
 * assignable to the runner's parameter and `tsc` said so in 15 errors that no
 * test could see. Two names for one contract is how that happens.
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
 * `pending` being non-empty IS "has invoked" (clause 7). It is assigned
 * synchronously by the call, before anything inside `next` awaits, so a
 * middleware that does not await still counts as having invoked. One slot, not a
 * boolean kept in step with it.
 *
 * A SECOND `next()` really does invoke the downstream again — retaining is not
 * memoising. Silencing a careless double call would blind the invocation counter
 * that exists to catch it.
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
    //
    // Measured 2026-09-19 through `executeWebRequest` with a builder-authored middleware that
    // fires `next()` without awaiting and returns its own `Response`, against a route that
    // throws: the client received 200 and the server died. Impossible before this contract,
    // because every result went through one `await` into the caller's try/catch.
    const invocations: Promise<Response | undefined>[] = []
    const next: WebNext = () => {
      const started = runFrom(index + 1)
      invocations.push(started)
      return started
    }

    const own = await middleware[index](request, context, next)

    // Clause 6 chooses between VALUES. An exception is not a value, and
    // `rules/error-handling.md § 2` forbids swallowing one — so every invocation is awaited
    // before the frame returns, and a downstream failure propagates even when clause 6 would
    // have preferred another frame's value. Failing the request is the recoverable error;
    // killing the process is not.
    const settled = await Promise.all(invocations)

    if (own instanceof Response) return own
    if (settled.length > 0) return settled[settled.length - 1]
    return await runFrom(index + 1)
  }

  return runFrom(0)
}
