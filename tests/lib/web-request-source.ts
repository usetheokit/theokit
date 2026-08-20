/**
 * Wrap a ready-made Web `Request` as the `WebRequestSource` the aux-route dispatcher takes.
 *
 * Production never does this: both callers of `serveAgentAuxRoute` hold a Node `IncomingMessage`
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
