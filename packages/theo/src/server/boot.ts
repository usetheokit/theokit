/**
 * M7-3 — `theokit/boot`: programmatic boot surface for the convention server.
 *
 * The programmatic surface is a Web `fetch` handler (the universal "fetch
 * handler is the entry point" contract — see the hono reference in
 * knowledge-base/discoveries/blueprints/m7-http-dual-surface-blueprint.md
 * "Coverage Corner 4"). It composes M7-1 (typed 404 envelope) + M7-2 (reserved
 * health/ready routes) and binds NO socket, so embedders + integration tests
 * can fire requests in-process via `app.fetch(new Request(...))`.
 *
 * The CLI's `startDevServer`/`startCommand` (Vite/SSR machinery) intentionally
 * stay in the `cli` module — `boot` must not depend on `cli` (architecture DAG:
 * nothing depends on `cli`). The fetch handler IS the portable boot surface.
 *
 * @public
 */

import { envelopeCodeToStatus } from '../core/contracts/envelope-code-to-status.js'
import { serverErrorToEnvelope } from '../core/contracts/server-error-to-envelope.js'
import { NotFoundError } from '../core/contracts/theo-error.js'

import { type ReservedRoutes, serveReservedRoute } from './define/health-route.js'

/** Options for {@link createConventionFetchHandler}. */
export interface ConventionFetchHandlerOptions {
  /** Reserved health/ready routes (M7-2). Liveness defaults to 200 even when omitted. */
  readonly reservedRoutes?: ReservedRoutes
}

/** A socketless convention-server handle. */
export interface ConventionFetchHandle {
  /** Serve a single request in-process (no socket). Reserved routes first, else a typed 404. */
  fetch(request: Request): Promise<Response>
  /** Idempotent teardown. The in-process handler holds no socket, so this is a safe no-op. */
  close(): Promise<void>
}

/**
 * Build an in-process convention-server `fetch` handler. Reserved `/__theo/*`
 * routes (health/ready) are served first; any other path yields a typed
 * `NOT_FOUND` envelope (404) via the same translator the wire boundary uses.
 */
export function createConventionFetchHandler(
  options: ConventionFetchHandlerOptions = {},
): ConventionFetchHandle {
  return {
    async fetch(request: Request): Promise<Response> {
      const pathname = new URL(request.url).pathname
      const reserved = await serveReservedRoute(pathname, options.reservedRoutes ?? {})
      if (reserved !== null) {
        return Response.json(reserved.body, { status: reserved.status })
      }
      const envelope = serverErrorToEnvelope(new NotFoundError(`No route for ${pathname}`))
      return Response.json(envelope, { status: envelopeCodeToStatus(envelope.code) })
    },
    // The in-process handler holds no socket, so teardown is a pure no-op
    // (trivially idempotent — calling it twice is safe).
    close(): Promise<void> {
      return Promise.resolve()
    },
  }
}
