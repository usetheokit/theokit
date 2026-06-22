/**
 * M7-2 — health/ready reserved routes for the convention/filesystem-route
 * server. Liveness (`/__theo/health`, always 200) and readiness
 * (`/__theo/ready`, 200/503 from a probe) are registered on a reserved
 * namespace BEFORE the user-route catch-all + 404 branch — mirroring nitro's
 * `/_nitro/*` reserved-namespace pattern (knowledge-base/references/nitro/src/
 * runtime/internal/routes/dev-tasks.ts). Liveness and readiness are kept
 * separate by design: liveness says "the process is up", readiness says
 * "dependencies are up".
 *
 * @public
 */

/** Reserved path for the liveness endpoint. */
export const HEALTH_PATH = '/__theo/health'
/** Reserved path for the readiness endpoint. */
export const READY_PATH = '/__theo/ready'

/** Config produced by {@link defineHealthRoute}. */
export interface HealthRouteConfig {
  readonly kind: 'health'
  /** Returns the liveness body (auto-serialized to JSON). Default: `{ status: 'ok' }`. */
  readonly handler: () => unknown
}

/** Config produced by {@link defineReadyRoute}. */
export interface ReadyRouteConfig {
  readonly kind: 'ready'
  /** Resolves `true` when dependencies are ready. A throw/reject is treated as not-ready (503). */
  readonly probe: () => boolean | Promise<boolean>
}

/** The reserved-route registry consulted by {@link serveReservedRoute}. */
export interface ReservedRoutes {
  readonly health?: HealthRouteConfig
  readonly ready?: ReadyRouteConfig
}

/** A reserved-route response: an HTTP status + a JSON-serializable body. */
export interface ReservedResponse {
  readonly status: number
  readonly body: unknown
}

/**
 * Define the liveness route. The default handler returns `{ status: 'ok' }`.
 * Liveness is always 200 — it asserts the process is up, not that dependencies are.
 */
export function defineHealthRoute(
  handler: () => unknown = () => ({ status: 'ok' }),
): HealthRouteConfig {
  return { kind: 'health', handler }
}

/**
 * Define the readiness route. The `probe` decides 200 (ready) vs 503 (not-ready).
 * A probe that throws/rejects is treated as not-ready (503) — never a 500 crash.
 */
export function defineReadyRoute(probe: () => boolean | Promise<boolean>): ReadyRouteConfig {
  return { kind: 'ready', probe }
}

/**
 * Pure dispatcher: map a request pathname to a reserved-route response, or
 * `null` when the path is not reserved (so the user catch-all + 404 take over).
 * Liveness defaults to 200 `{status:'ok'}`; readiness without a probe is
 * trivially ready (200). Registered BEFORE the user catch-all by the caller.
 */
export async function serveReservedRoute(
  pathname: string,
  routes: ReservedRoutes = {},
): Promise<ReservedResponse | null> {
  if (pathname === HEALTH_PATH) {
    const handler = routes.health?.handler ?? (() => ({ status: 'ok' }))
    return { status: 200, body: handler() }
  }
  if (pathname === READY_PATH) {
    const probe = routes.ready?.probe
    if (probe === undefined) {
      return { status: 200, body: { status: 'ready' } }
    }
    try {
      const ready = await probe()
      return ready
        ? { status: 200, body: { status: 'ready' } }
        : { status: 503, body: { status: 'not-ready' } }
    } catch (err) {
      // 503 (the dependency is not ready) but NEVER swallow the cause — a
      // readiness probe failing silently is invisible to ops (project rule:
      // "NUNCA engula exceções"). Log the cause, keep the 503 contract.
      console.error('[theo] readiness probe threw — treating as not-ready', err)
      return { status: 503, body: { status: 'not-ready' } }
    }
  }
  return null
}
