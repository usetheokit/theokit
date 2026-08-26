/**
 * `appliesConfig` is a CLAIM, and this is where the rest of it gets checked (#478).
 *
 * `tests/unit/adapter-config-claim-is-true.test.ts` closed `rateLimit` (#461) with a marker regex,
 * which works there because nothing else in an emitted entry mentions a limiter. #478 explains why
 * that technique does NOT generalise, and it is right: an entry imports `withSecurityHeaders` and
 * `createCorsWebHandler` whether or not the operator's SETTINGS reach them, so a marker would pass
 * on an adapter that imports the helper and drops the config — a gate green on the defect it exists
 * to catch.
 *
 * So this asks a different question, and one the emitted source can actually answer. Every entry
 * bakes its config as a literal (a deployed function has no `theo.config.ts` to read), so render
 * each target TWICE — once with nothing configured, once with a value chosen to be unmistakable —
 * and require the value to appear. An adapter that imports the mechanism and forgets the settings
 * produces two identical renders and fails here.
 *
 * Measured before writing: `renderVercelFunctionEntry({ securityHeaders: { frameOptions: 'DENY' } })`
 * emits `const SECURITY_HEADERS_CONFIG = {"frameOptions":"DENY"}`, and the empty call emits `{}`.
 *
 * `plugins` is deliberately NOT swept here, and the reason is worth recording because getting it
 * wrong cost a wrong "fix" first. Rendering an entry with `runtimeConfigModule` set proves the
 * renderer would honour it — and every renderer does. It says nothing about whether the BUILD ever
 * supplies it, and only three of the six do (`cloudflare`, `bun`, `deno-deploy` pass
 * `pluginsPlan?.moduleSpecifier`; the other three never call with it, because they ship a
 * standalone function directory that never sees the app's source). Sweeping `plugins` here made
 * three adapters look like they under-declared, and adding the claim would have promised support
 * that breaks at deploy. `adapter-config-contract.test.ts` pins that split with its reason.
 *
 * The distinction generalises: this file answers "does a configured value reach the emitted
 * source", which is the right question only for concerns the build always passes through.
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
 * What "the operator's value reached the emitted entry" looks like, per concern.
 *
 * A PATTERN rather than a plain string, because `csrf` takes an enum — `off | warn | strict` — and
 * none of those words is unusual enough to be evidence on its own. The first draft used the bare
 * `'warn'` and the leak-guard below caught it: an AWS Lambda entry contains `console.warn`, so the
 * substring proved nothing. The other two get to invent an unmistakable value; csrf has to be
 * matched where it lands.
 */
const SENTINELS = {
  securityHeaders: /no-referrer-sentinel/,
  cors: /https:\/\/cors-sentinel\.test/,
  csrf: /csrfMode:\s*"warn"/,
  disallowed: /\/api\/disallowed-sentinel/,
  // `'json'` and `undefined` both mean the default and emit NOTHING by design — the fallback is
  // already `JSON.stringify` and the `x-theo-transformer` header is deliberately absent for it. So
  // the only value that can be evidence here is the non-default one.
  serialization: /superjson/,
} as const

/**
 * The value handed to the renderer, per concern.
 *
 * Kept separate from the pattern above, which the first draft did not: it reused the sentinel for
 * both, so once the sentinels became RegExps a RegExp was passed as `referrerPolicy` and serialised
 * to `{}`. Every case then failed for a reason that had nothing to do with the adapters.
 */
const CONFIGURED = {
  securityHeaders: { securityHeaders: { referrerPolicy: 'no-referrer-sentinel' } },
  cors: { cors: { origins: 'https://cors-sentinel.test', credentials: false, maxAge: 600 } },
  csrf: { csrf: 'warn' },
  disallowed: { disallowed: { routes: ['/api/disallowed-sentinel'] } },
  serialization: { serialization: 'superjson' },
} as const

/**
 * All six targets whose handler is emitted as source. The renderers differ only in what precedes
 * the options — a port, or nothing — so each is adapted at the call site rather than through a
 * cast. Casting is what produced two false findings while this file was being written: `as never`
 * silenced the compiler on a config shape that was wrong, twice, and the wrong shape looked exactly
 * like an adapter dropping the value.
 */
const ENTRIES = {
  vercel: (o: object) => renderVercelFunctionEntry(o),
  netlify: (o: object) => renderNetlifyFunction(o),
  'deno-deploy': (o: object) => renderDenoEntry(3000, o),
  'aws-lambda': (o: object) => renderAwsLambdaEntry(o),
  bun: (o: object) => renderBunEntry(3000, o),
  cloudflare: (o: object) => renderCloudflareWorkerEntry(o),
} as Record<string, (o: object) => string>

describe.each(Object.keys(ENTRIES))('%s', (target) => {
  it.each(Object.keys(SENTINELS))(
    'carries the configured %s into the emitted entry when it claims to apply it',
    async (concern) => {
      const adapter = await resolveAdapter(target as Parameters<typeof resolveAdapter>[0])
      const declared = adapter.appliesConfig
      const claims =
        declared !== undefined &&
        declared !== 'runtime-not-emitted-here' &&
        declared.includes(concern as never)

      const sentinel = SENTINELS[concern as keyof typeof SENTINELS]
      const configured = ENTRIES[target](CONFIGURED[concern as keyof typeof CONFIGURED])
      const bare = ENTRIES[target]({})

      const reaches = sentinel.test(configured)

      // The empty render must NOT match — otherwise "it appeared" would prove nothing about the
      // config having travelled, and this whole file would be measuring its own sentinel.
      expect(
        sentinel.test(bare),
        `${target}: the ${concern} sentinel matches an UNCONFIGURED render, so it is not evidence`,
      ).toBe(false)

      expect(
        reaches,
        claims
          ? `${target} declares ${concern} in appliesConfig, so \`theokit build\` stays SILENT about it — but the operator's value never reaches the emitted entry. The silence reads as confirmation.`
          : `${target} does not declare ${concern}, yet the configured value reaches its emitted entry. Either add the claim or stop emitting it — the build warning and the code must agree.`,
      ).toBe(claims)
    },
  )
})
