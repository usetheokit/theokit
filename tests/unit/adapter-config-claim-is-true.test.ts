/**
 * `appliesConfig` is a CLAIM; this is the test that checks it (usetheokit/theokit#461).
 *
 * `adapter-config-contract.test.ts` makes each adapter declare which config its handler applies,
 * and states its own hole in the same breath:
 *
 *   "What this cannot do is prove the declaration is true. `appliesConfig` is a claim the adapter
 *    makes about its own emitted handler, and a wrong claim here is indistinguishable from a right
 *    one."
 *
 * For most concerns a wrong claim is a bug. For `rateLimit` it is a security regression with the
 * failure pointing the wrong way: the declaration is what SILENCES the build warning, so adding
 * `'rateLimit'` to an adapter's list without wiring anything tells the operator they are protected
 * and removes the one line that said otherwise. That is #321 one level up — a limit that silently
 * does not apply, with the operator's attention removed as well.
 *
 * The six Web-standards targets emit their handler as source text, so the claim IS checkable there:
 * either the emitted entry reaches a limiter or it does not. This asserts the two agree.
 *
 * `node` is not here, and not by omission: it applies the limit in `theokit start`
 * (`cli/commands/start/index.ts` builds it, `handlers.ts` calls it), not in an emitted file. There
 * is no text to read, so this technique cannot cover it — stated rather than left as an apparent
 * gap in the table.
 */
import { describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'
import { resolveAdapter } from '../../packages/theo/src/adapters/registry.js'

/**
 * The targets whose handler is emitted as source, keyed by the name `resolveAdapter` takes.
 *
 * Each renderer takes the rate limit to declare, because #508 made the distinction matter: a target
 * that ENFORCES a declared limit emits its limiter only when one is declared, and emitting one
 * unconditionally would be dead code in every app that declares none. Rendering with an empty
 * config could not tell "this target has no such capability" from "this app asked for nothing",
 * and read the second as the first.
 */
const EMITTED_ENTRIES: Record<string, (rateLimit?: RateLimit) => string> = {
  vercel: () => renderVercelFunctionEntry({}),
  netlify: () => renderNetlifyFunction({}),
  bun: (rateLimit) => renderBunEntry(3000, { rateLimit }),
  'deno-deploy': () => renderDenoEntry(3000, {}),
  'aws-lambda': () => renderAwsLambdaEntry({}),
  cloudflare: () => renderCloudflareWorkerEntry({ ssrStreaming: false }),
}

/** A limit any target claiming the capability must be able to carry. */
interface RateLimit {
  windowMs: number
  max: number
}
const DECLARED_LIMIT: RateLimit = { windowMs: 60_000, max: 100 }

/**
 * What reaching a limiter looks like in an emitted entry.
 *
 * Deliberately broad: the point is to catch a declaration with NOTHING behind it, so any plausible
 * spelling counts as wiring. A narrow pattern would fail the day someone wires it correctly under
 * a name this list did not predict, which teaches people to edit the test instead of the adapter.
 */
const LIMITER_MARKER = /rateLimit|rate-limit|RateLimiter|rateLimiter/

/**
 * The emitted entry with its import lines removed, which is what the marker is applied to.
 *
 * An import is a declaration of intent; wiring is a call. Left in, `import { createRateLimiterWeb }`
 * alone satisfies a marker looking for `RateLimiter` — so a target could claim the capability,
 * import the symbol, never call it, and pass. That is precisely the "declaration with nothing
 * behind it" this file exists to catch, and it was reachable here until #508 made the import
 * conditional and exposed it.
 *
 * The marker stays deliberately broad for the reason stated above it; narrowing the TEXT rather
 * than the PATTERN keeps that breadth while restoring what the assertion can fail on.
 */
function emittedBody(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .join('\n')
}

describe.each(Object.entries(EMITTED_ENTRIES))('%s', (target, render) => {
  it('emits a limiter when it claims to apply rateLimit, and none when it does not', async () => {
    const adapter = await resolveAdapter(target as Parameters<typeof resolveAdapter>[0])
    const declared = adapter.appliesConfig
    const claimsRateLimit =
      declared !== undefined &&
      declared !== 'runtime-not-emitted-here' &&
      declared.includes('rateLimit')

    // Rendered WITH a limit declared: that is the only state in which the claim is testable.
    const wiresLimiter = LIMITER_MARKER.test(emittedBody(render(DECLARED_LIMIT)))

    expect(
      wiresLimiter,
      claimsRateLimit
        ? `${target} declares rateLimit in appliesConfig, so the build stays SILENT about it — but its emitted entry reaches no limiter even when one is declared. An operator reading that silence believes the limit applies.`
        : `${target} does not declare rateLimit, yet its emitted entry mentions one. Either wire it and add the claim, or remove what is there — the build warning and the code must say the same thing.`,
    ).toBe(claimsRateLimit)

    // The other half of the same honesty, and the reason the renderer takes an argument: a target
    // that CAN enforce must emit nothing when the app declared nothing. Otherwise every app carries
    // an inert limiter, and the next reader cannot tell an unused one from a broken one.
    if (claimsRateLimit) {
      expect(
        LIMITER_MARKER.test(emittedBody(render(undefined))),
        `${target} emits a limiter even though the app declared none — inert code an operator may read as protection.`,
      ).toBe(false)
    }
  })
})
