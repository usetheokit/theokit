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

/** The targets whose handler is emitted as source, keyed by the name `resolveAdapter` takes. */
const EMITTED_ENTRIES: Record<string, () => string> = {
  vercel: () => renderVercelFunctionEntry({}),
  netlify: () => renderNetlifyFunction({}),
  bun: () => renderBunEntry(3000, {}),
  'deno-deploy': () => renderDenoEntry(3000, {}),
  'aws-lambda': () => renderAwsLambdaEntry({}),
  cloudflare: () => renderCloudflareWorkerEntry({ ssrStreaming: false }),
}

/**
 * What reaching a limiter looks like in an emitted entry.
 *
 * Deliberately broad: the point is to catch a declaration with NOTHING behind it, so any plausible
 * spelling counts as wiring. A narrow pattern would fail the day someone wires it correctly under
 * a name this list did not predict, which teaches people to edit the test instead of the adapter.
 */
const LIMITER_MARKER = /rateLimit|rate-limit|RateLimiter|rateLimiter/

describe.each(Object.entries(EMITTED_ENTRIES))('%s', (target, render) => {
  it('emits a limiter when it claims to apply rateLimit, and none when it does not', async () => {
    const adapter = await resolveAdapter(target as Parameters<typeof resolveAdapter>[0])
    const declared = adapter.appliesConfig
    const claimsRateLimit =
      declared !== undefined &&
      declared !== 'runtime-not-emitted-here' &&
      declared.includes('rateLimit')

    const emitted = render()
    const wiresLimiter = LIMITER_MARKER.test(emitted)

    expect(
      wiresLimiter,
      claimsRateLimit
        ? `${target} declares rateLimit in appliesConfig, so the build stays SILENT about it — but its emitted entry reaches no limiter. An operator reading that silence believes the limit applies.`
        : `${target} does not declare rateLimit, yet its emitted entry mentions one. Either wire it and add the claim, or remove what is there — the build warning and the code must say the same thing.`,
    ).toBe(claimsRateLimit)
  })
})
