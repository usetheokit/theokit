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

/** A Web-path middleware: mutate `context`, or return a `Response` to short-circuit. */
export type WebMiddleware = (
  request: Request,
  context: Record<string, unknown>,
  // A middleware may mutate `context` and return nothing (void) OR return a
  // `Response` to short-circuit (Express/Koa-style). `void` in this union is
  // intentional — `runWebMiddleware` only inspects `instanceof Response`, so a
  // void return means "continue to the next middleware / handler".
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
) => Promise<Response | undefined> | Response | undefined | void

/**
 * Run middleware in order against a shared mutable `context`. The first
 * middleware that returns a `Response` short-circuits the chain (the handler
 * is not reached); its `Response` is returned verbatim so headers like
 * `Set-Cookie` are preserved (EC-11). Returns `undefined` when every
 * middleware passes (the handler should run next).
 */
export async function runWebMiddleware(
  request: Request,
  middleware: readonly WebMiddleware[],
  context: Record<string, unknown>,
): Promise<Response | undefined> {
  for (const mw of middleware) {
    const result = await mw(request, context)
    if (result instanceof Response) return result
  }
  return undefined
}
