/**
 * The limiter's wiring, as a REAL file the compiler reads.
 *
 * ## Why it lives in `server/` and not beside the adapter that emits its call
 *
 * It was written under `adapters/entries/` first, and `/code-quality` refused it: the declared rule
 * `adapters-may-only-depend-on-core-router-services` lets `adapters/` reach `core/`, `router/`,
 * `services/` and `config/`, and nothing else. The plan had asserted "architecture boundary crossed:
 * none" without checking that rule, and the gate was right — this file is RUNTIME wiring. It builds
 * the limiter a request is answered by; it does not participate in the build. `server/` is where the
 * thing it wires already lives.
 *
 * B-262 — this file exists because of a measurement taken while implementing the task that preceded
 * it. The first design moved the limiter's import inside the emitted string, from
 * `theokit/server/rate-limit` to a bundler virtual id, and claimed that gave `tsc` sight of the
 * symbol. It does not: `renderCloudflareWorkerEntry` RETURNS a 215-line string, and
 * `tsconfig.json` includes the package-source include pattern — source, never build output. **No string is
 * type-checked, whatever its import says.**
 *
 * B-257 paid the bill for that invisibility: `createDurableRateLimiterWeb` was used at module scope
 * in an emitted entry and never imported, the entry threw when it LOADED, and the compiler reported
 * nothing. The only instrument that caught it was a test that loads and drives the generated entry.
 *
 * Deleting either import below fails `npx tsc --noEmit`, naming the symbol, before any test runs.
 * That is the whole reason this is a file rather than a fragment.
 *
 * ## What stays emitted, and why it must
 *
 * The VALUES — the window, the max, the store the app named — exist only at build time, so they
 * cannot live here. They arrive as arguments. The adapter emits the call; this file holds the
 * decision the call is made of.
 */

import { createDurableRateLimiterWeb } from './rate-limit-durable.js'
import type { RateLimitStore } from './rate-limit-store.js'
import type { RateLimitConfig, RateLimitResult } from './rate-limit.js'
import { createRateLimiterWeb } from './rate-limit.js'

/**
 * The limiter a deployed entry should use, given what the app declared.
 *
 * Always async, whichever branch runs. The sync facade returns a value and the durable one returns a
 * Promise, and an entry that had to know which it got would be an entry whose call site changes with
 * the config — the shape that produced B-257's `await` defect. One signature removes the question.
 */
export function buildRateLimiter(
  config: RateLimitConfig,
  store: RateLimitStore | undefined,
): (clientIp: string) => Promise<RateLimitResult> {
  // Nullish rather than `=== undefined`, and the difference is a self-inflicted denial of service.
  // The signature says `RateLimitStore | undefined` and the type is erased before this runs, so a
  // `null` reaches here from any untyped caller. Measured with `=== undefined`: the null fell to the
  // durable branch, `store.incr` threw, ADR 0019's fail-closed caught it, and every caller was
  // refused with a header naming a store outage that had not happened. Failing closed is right for
  // an unreachable store and wrong for an argument that was never a store.
  // `== null` is the one comparison that answers both, and it is deliberate: `no-unnecessary-condition`
  // calls an explicit `=== null` dead here because the TYPE says it cannot happen, and the type is
  // right about the type and blind to the boundary. The loose form carries no dead comparison for the
  // checker to object to, and `eqeqeq` permits it for nullish on its own configuration here.
  if (store == null) {
    // A runtime with a long-lived process keeps its counter between requests, which is why `node`
    // and `bun` declare `enforcesRateLimit: 'always'`. The fallback is not a degradation there —
    // it is the correct limiter for that shape of host.
    const sync = createRateLimiterWeb(config)
    return (clientIp: string) => Promise.resolve(sync(clientIp))
  }

  return createDurableRateLimiterWeb(config, { store })
}
