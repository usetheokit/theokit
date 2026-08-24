/**
 * Wrap a ready-made Web `Request` as the `WebRequestSource` the agent branches take, and play the
 * caller of the aux-route dispatcher.
 *
 * Production never does the first part: both callers hold a Node `IncomingMessage`
 * and build the source with `createWebRequestSource`, whose whole point (theokit#400) is that the
 * conversion — and the one-shot drain of the Node stream that comes with it — is deferred until a
 * branch has decided it owns the path. A test that already has a `Request` has nothing to defer,
 * so this exists in `tests/` and not in `src/`: shipping it would hand production an easy way to
 * convert early again, which is the defect.
 *
 * `calls` is the point of the helper, not a convenience. It counts how many times the dispatcher
 * asked for the request, which is what lets a test assert the invariant directly — a path the
 * dispatcher does NOT own must be answered without ever touching the body.
 */
import {
  matchAgentAuxRoute,
  serveMatchedAuxRoute,
} from '../../packages/theo/src/server/agent/serve-aux-routes.js'
import type { WebRequestSource } from '../../packages/theo/src/server/http/node-request.js'

export interface CountingRequestSource extends WebRequestSource {
  /** How many times `toRequest()` has been called. */
  readonly calls: number
}

export function sourceOf(request: Request): CountingRequestSource {
  let calls = 0
  return {
    method: request.method.toUpperCase(),
    toRequest: () => {
      calls++
      return request
    },
    get calls() {
      return calls
    },
  }
}

/**
 * Match then serve — the two-step both production callers perform, in one call, so a test can ask
 * "what does this url get?" without restating the caller.
 *
 * The steps are separate in production because the gap between them is where the plugin lifecycle
 * runs (usetheokit/theokit#405). They are joined here because these tests are about what the
 * dispatcher answers, and joining them keeps the conversion count meaningful: `toRequest()` is
 * called exactly when a route matched, never to decide whether one did.
 */
export async function dispatchAuxRoute(
  source: WebRequestSource,
  urlPath: string,
  deps: Parameters<typeof matchAgentAuxRoute>[2],
): Promise<Response | null> {
  const route = await matchAgentAuxRoute(source.method, urlPath, deps)
  return route === null ? null : serveMatchedAuxRoute(route, source.toRequest(), deps)
}
