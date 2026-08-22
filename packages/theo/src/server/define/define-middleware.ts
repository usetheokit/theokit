/**
 * A middleware, as the framework's own builder produces it (usetheokit/theokit#345).
 *
 * `(request, context)`: read the request as a Web `Request`, decorate `context` for the route that
 * follows, and RETURN a `Response` to answer the request yourself. Returning nothing continues to
 * the next middleware, and then to the route.
 *
 * ## Why not `(request, next) => Response`
 *
 * That was this type's first shape, and it described a continuation pipeline nothing in this
 * repository implements: the file-scan runner runs BEFORE routing, so it has no downstream
 * `Response` to hand back from `next(request)`. The consequence was measured rather than
 * theorised — `MiddlewareHandler` had **zero runtime consumers**, while `README.md` documented the
 * builder that produces it as the way to write middleware. A published builder whose output nothing
 * can call is worse than a missing one, because it reads as supported.
 *
 * This shape is the one that fits the model AND already runs: `executeWebRequest` has invoked
 * `(request, context) => Response | void` since T3.2 (`http/web-middleware-runner.ts`). Adopting it
 * here converges two of the three middleware contracts instead of adding a fourth.
 *
 * The Express-style `(req, res, next)` export keeps working in `server/middleware/*.ts`. It is
 * Node-bound — which is why it cannot be the framework's contract — but evicting it would break
 * every app that has one.
 */
export type MiddlewareHandler = (
  request: Request,
  context: Record<string, unknown>,
  // `void` is deliberate: returning nothing is how a middleware says "continue". The runner only
  // inspects `instanceof Response`, so there is nothing to distinguish from `undefined`.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
) => Response | undefined | void | Promise<Response | undefined | void>

/**
 * Marks a handler as declaring the Web-shaped contract above.
 *
 * `server/middleware/*.ts` may export either shape, and both are plain functions, so a `typeof`
 * screen cannot tell them apart. Arity cannot either: a hand-written Node middleware that ignores
 * `next` also has length 2, and treating that as Web-shaped would hand it a `Request` it does not
 * expect. So the shape is RECORDED where it is declared rather than guessed where it is consumed,
 * and the runner dispatches on the brand (usetheokit/theokit#345).
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
