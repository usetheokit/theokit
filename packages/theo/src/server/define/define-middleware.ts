export type MiddlewareHandler = (
  request: Request,
  next: (request: Request) => Promise<Response>,
) => Response | Promise<Response>

/**
 * Marks a handler as declaring the Web-shaped contract above.
 *
 * The file-scan runner invokes `(req, res, next)` against Node's `IncomingMessage`
 * and `ServerResponse`. Both shapes are functions, so a `typeof` screen cannot
 * tell them apart, and the mismatch used to surface as a TypeError from inside
 * framework code or — worse — as a blank response, because a handler that
 * returns a `Response` never calls the runner's `next` and the request aborts
 * with nothing written (usetheokit/theokit#345).
 *
 * Arity cannot decide it either: a hand-written Node middleware that ignores
 * `next` also has length 2, and refusing that would break more than the check
 * protects. So the shape is recorded where it is declared rather than guessed
 * where it is consumed.
 *
 * @internal
 */
export const WEB_SHAPED_MIDDLEWARE = Symbol.for('theokit.middleware.web-shaped')

/**
 * Define a middleware handler.
 *
 * Identity function — provides the type annotation, and records the declared
 * shape so a runner that cannot invoke it can say so by name. The brand is
 * non-enumerable, so it does not appear in spreads, `Object.keys` or a JSON
 * round-trip of anything holding the handler.
 */
export function defineMiddleware(handler: MiddlewareHandler): MiddlewareHandler {
  Object.defineProperty(handler, WEB_SHAPED_MIDDLEWARE, {
    value: true,
    enumerable: false,
    configurable: true,
  })
  return handler
}
