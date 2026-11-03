import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'
import { BUILD_HOOK_TIMEOUT_MS, buildTheokitPackageOnce } from './_helpers/build-theokit-package.js'
import { loadDeployedEntry } from './_helpers/drive-deployed-entry.js'

/**
 * B-027 / T0.1 — the gate that can see what a `grep` cannot.
 *
 * Twelve panel rounds returned this item's plan, and every finding was the same kind: the plan
 * described emitted code that would not run, and every criterion it carried was a `grep` over the
 * rendered string. A render-contains assertion cannot see an unbound identifier, an unimported
 * symbol, a call site that was never emitted, or a guard that was never written. The votes are in
 * `.squad/records/panels/a-declared-rate-limit-names-its-caller-plan.round*.json` — thirteen files for
 * twelve rounds, because two rounds were archived mid-flight (`8a`, `10a`/`10b`) when the artifact
 * changed after a vote was cast.
 *
 * So this loads each emitted entry and DRIVES its handler: two requests against a `max: 1` budget,
 * and one with no address anywhere. Six targets, six calling conventions, three response shapes —
 * a `Response`, a drain into `nodeRes`, a Lambda v2 result — which is why `load()` is per-target.
 *
 * **The first version of this file did not drive anything.** It ended at
 * `expect(handler).toBeTypeOf('function')` under a name promising refusal, and both `/review`
 * specialists returned it as a BLOCKER. That is the same failure the panel spent twelve rounds on,
 * committed one level up: an assertion that LOOKS behavioural, reached through a real dynamic
 * import, certifying nothing about behaviour. Kept in the record because the shape is the lesson.
 *
 * ## Why the specifiers are rewritten to `dist`
 *
 * Every entry opens with STATIC bare imports — `theokit/server`, `theokit/adapters/web-shim`, and
 * for some `theokit/server/http` and `theokit/adapters/ws-shim`; the deno one prefixes them `npm:`.
 * ESM hoists those above everything, so they decide whether the module loads at all, and none of
 * them resolves from a temp directory:
 *
 * | tried | Node answers |
 * |---|---|
 * | `import 'npm:theokit/server'` | `ERR_UNSUPPORTED_ESM_URL_SCHEME` — Node has no `npm:` scheme |
 * | `import 'theokit/server'` from a temp dir | `ERR_MODULE_NOT_FOUND` — there is no `node_modules/theokit` at this repo root |
 *
 * Vitest's aliases do not save it either: `vitest.config.ts` aliases four `theokit*` prefixes and
 * zero `theokit/adapters/*`, so a string alias prefix-matches `theokit/adapters/web-shim` into
 * `…/src/index.ts/adapters/web-shim` — the nonsense-path trap that file records as measured three
 * times, whose symptom it describes as "not a failing test".
 *
 * Resolving through `packages/theo/dist` and the package's own `exports` map is what a deployed
 * entry actually imports. It needs no alias and no workspace link, and it is the instrument
 * `the-builder-runs-in-the-published-build.test.ts` established for B-003.
 *
 * ## Why two entries need runtime stubs
 *
 * `bun` and `deno-deploy` export no handler — they call `Bun.serve({…})` and `Deno.serve(…)` at
 * module scope. Both also read other globals first, and **bun calls `process.exit(1)` on each failed
 * guard**, so a partial stub terminates the vitest worker instead of failing a test.
 */

/** A limit small enough that two requests trip it. */
const LIMIT = { windowMs: 60_000, max: 1 } as const

/** The header that makes a request an upgrade, for the entries that branch on it. */
const UPGRADE = { upgrade: 'websocket' } as const

/**
 * The entries carrying a WebSocket upgrade branch. The other four never see one, so asserting a
 * 429 there would assert that an ordinary request is refused — a different claim, already made by
 * `refuses_an_over_budget_caller`. Derived by reading the renders, not assumed: `vercel`,
 * `netlify`, `bun` and `aws-lambda` emit no `upgrade` test at all.
 */
const UPGRADE_TARGETS: ReadonlySet<Target> = new Set<Target>(['cloudflare', 'deno-deploy'])

/**
 * The render functions, with the limit passed through.
 *
 * `DeployedEntryOptions` does NOT include `DeployedRateLimitOptions` today — `types.ts:29-35`
 * composes six option types and that is not one of them, and only `bun.ts:78` intersects it in. So
 * the five other renders ignore the key entirely, which is precisely the RED state: they emit no
 * limiter at all. Widening `DeployedEntryOptions` is part of T1.1.
 */
const ENTRIES = [
  ['cloudflare', () => renderCloudflareWorkerEntry({ ssrStreaming: false, rateLimit: LIMIT })],
  ['bun', () => renderBunEntry(3000, { rateLimit: LIMIT })],
  ['deno-deploy', () => renderDenoEntry(3000, { rateLimit: LIMIT })],
  // `trustProxy: 1` for this target ONLY, and it is a finding rather than a fixture convenience.
  // Vercel's sole source is the forwarded header, and `client-ip.ts:75` returns `undefined` when
  // no proxy is trusted — so a limit declared on Vercel without `trustProxy` can never name
  // anybody, and every request takes the 503. That is the plan's open question Q4, answered by
  // execution: this test read 503 where it expected 429 until the trust was declared.
  ['vercel', () => renderVercelFunctionEntry({ rateLimit: { ...LIMIT, trustProxy: 1 } })],
  ['netlify', () => renderNetlifyFunction({ rateLimit: LIMIT })],
  ['aws-lambda', () => renderAwsLambdaEntry({ rateLimit: LIMIT })],
] as const satisfies readonly (readonly [string, () => string])[]

/**
 * B-257 — the same six renders, with a durable store declared.
 *
 * `LIMIT` above exercises the in-process path. A store sends the emitter down a DIFFERENT branch:
 * it imports the factory from the declared module, constructs it, and calls
 * `createDurableRateLimiterWeb` instead of `createRateLimiterWeb` — three emitted things that the
 * first table never produces.
 *
 * It is a second table rather than a third assertion on the first, because the branch is chosen by
 * the CONFIG. A test reading the in-process render can say nothing about the durable one, however
 * carefully it reads.
 *
 * Only the binding is asserted here, not behaviour. Driving this handler would need
 * `@theo-test/durable-store` to resolve from the temp workspace, and a stub written to satisfy the
 * import is a stub the assertion is really about. The class this catches is the one the review
 * named: a symbol used at module scope and never imported throws when the entry LOADS, and no
 * render-contains assertion can see it.
 */
const STORE = { module: '@theo-test/durable-store', factory: 'createStore' } as const
const DURABLE_ENTRIES = [
  [
    'cloudflare',
    () =>
      renderCloudflareWorkerEntry({ ssrStreaming: false, rateLimit: { ...LIMIT, store: STORE } }),
  ],
  ['deno-deploy', () => renderDenoEntry(3000, { rateLimit: { ...LIMIT, store: STORE } })],
  [
    'vercel',
    () => renderVercelFunctionEntry({ rateLimit: { ...LIMIT, trustProxy: 1, store: STORE } }),
  ],
  ['netlify', () => renderNetlifyFunction({ rateLimit: { ...LIMIT, store: STORE } })],
  ['aws-lambda', () => renderAwsLambdaEntry({ rateLimit: { ...LIMIT, store: STORE } })],
] as const satisfies readonly (readonly [string, () => string])[]

type Target = (typeof ENTRIES)[number][0]

let workspace: string

/**
 * Load an emitted entry and return a driver that sends ONE request and answers with its status.
 * The loading and the six calling conventions live in `_helpers/drive-deployed-entry.ts`; what
 * stays here is the address each runtime reads, so `address: undefined` really means "nothing to
 * key on".
 */
async function load(
  target: Target,
  source: string,
): Promise<(address: string | undefined, extra?: Record<string, string>) => Promise<number>> {
  const drive = await loadDeployedEntry(target, source, workspace)
  function headersFor(
    address: string | undefined,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    if (address === undefined) return { ...extra }
    // `cf-connecting-ip` is the header the Workers runtime writes and the only one that target
    // reads first; every other Web target falls through to the forwarded chain.
    if (target === 'cloudflare') return { 'cf-connecting-ip': address, ...extra }
    return { 'x-forwarded-for': address, ...extra }
  }
  return async (address, extra) =>
    (await drive({ path: '/api/thing', headers: headersFor(address, extra), address })).status
}

describe('every deployed entry limits its caller (B-027, T0.1)', () => {
  beforeAll(() => {
    buildTheokitPackageOnce()
    workspace = mkdtempSync(join(tmpdir(), 'theo-rl-'))
    mkdirSync(workspace, { recursive: true })
  }, BUILD_HOOK_TIMEOUT_MS)

  afterAll(() => {
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true })
  })

  for (const [target, render] of ENTRIES) {
    describe(target, () => {
      it(`test_${target.replace(/-/g, '_')}_declares_a_limiter_at_all`, () => {
        // Finding 2 of round 8: five entries would declare a limiter and never invoke it — and
        // five would not even declare one, because their render ignores the option.
        const source = render()
        expect(
          source,
          `${target} emits no limiter for a declared rateLimit; ` +
            `DeployedEntryOptions does not carry the option yet (types.ts:29-35)`,
        ).toContain('createRateLimiterWeb')
      })

      it(`test_${target.replace(/-/g, '_')}_imports_what_it_uses`, () => {
        // Finding 1 of round 8: `createRateLimiterWeb` is used at module scope and imported by
        // exactly one adapter. Unbound there, the entry throws when it LOADS.
        const source = render()
        if (!source.includes('createRateLimiterWeb')) return
        expect(
          /import\s*\{[^}]*createRateLimiterWeb/.test(source),
          `${target} uses createRateLimiterWeb and never imports it`,
        ).toBe(true)
      })

      it(`test_${target.replace(/-/g, '_')}_refuses_an_over_budget_caller`, async () => {
        const drive = await load(target, render())
        // `max: 1`, so the second request is over budget. The first is expected to answer
        // whatever the route layer gives it — a 404, since no server dir exists here — and only
        // the SECOND is this test's subject.
        await drive('1.2.3.4')
        expect(await drive('1.2.3.4'), `${target} did not refuse a second request`).toBe(429)
      })

      it(`test_${target.replace(/-/g, '_')}_counts_a_websocket_upgrade_against_the_budget`, async () => {
        // Found by `loop-code-review` as LCR0103 against `cloudflare.ts:489`, and the same shape
        // was then measured in `deno-deploy.ts:121` — two adapters, one reasoning error, and the
        // audit named only the first.
        //
        // Both entries answer a WebSocket upgrade ABOVE the rate-limit check, under the comment
        // "A 101 carries no document and no script, so the security baseline does not apply to
        // it." That sentence is true of `withSecurityHeaders` — a document concern — and it is
        // NOT true of the limiter, which is a resource concern. A long-lived socket is the most
        // expensive thing this adapter hands out, so the upgrade is the path that most needs the
        // budget, not the one that may skip it.
        //
        // Driven, not grepped: two upgrades against `max: 1`. The second must be refused. Neither
        // fixture declares a WS route, so today both answer 404 and the caller may repeat that
        // for free — which is the bypass, independently of whether a route existed.
        if (!UPGRADE_TARGETS.has(target)) return
        const drive = await load(target, render())
        await drive('203.0.113.9', UPGRADE)
        expect(
          await drive('203.0.113.9', UPGRADE),
          `${target} answered a second WebSocket upgrade from one caller under max: 1 without ` +
            `refusing it: the upgrade branch returns before the limiter is ever consulted.`,
        ).toBe(429)
      })

      it(`test_${target.replace(/-/g, '_')}_refuses_a_caller_it_cannot_name`, async () => {
        const drive = await load(target, render())
        // No address anywhere: no `cf-connecting-ip`, no forwarded header, no runtime source, and
        // `trustProxy` unset. The guard must answer 503 — `rate-limit.ts:113` is
        // `clientIp.length > 0`, so reaching the limiter with `undefined` is a TypeError instead.
        expect(await drive(undefined), `${target} did not refuse an unnameable caller`).toBe(503)
      })
    })
  }

  for (const [target, render] of DURABLE_ENTRIES) {
    describe(`${target} with a durable store`, () => {
      it(`test_${target.replace(/-/g, '_')}_awaits_the_durable_limiter`, () => {
        // The durable limiter returns a Promise. An entry that emitted the sync call site around
        // it would read `limited` off a Promise — always `undefined`, always falsy, so every
        // request passes and the limit silently does nothing.
        const source = render()
        // B-262 renamed what the entry calls: `buildRateLimiter` is one signature over both
        // limiters, so the emitted call no longer names which one it got. What must still hold is
        // that a declared store REACHES a limiter, and that the call below is awaited.
        expect(source, `${target} declares a store and never reaches a limiter`).toContain(
          'buildRateLimiter(',
        )
        expect(
          /await\s+RATE_LIMIT\(/.test(source),
          `${target} calls the durable limiter without awaiting it; every request reads ` +
            `\`limited\` off a Promise and passes`,
        ).toBe(true)
      })

      it(`test_${target.replace(/-/g, '_')}_imports_every_symbol_the_durable_path_uses`, () => {
        // The class the review named, on the branch the first table never renders: three symbols
        // are used at module scope here, and each one unbound throws at LOAD time.
        const source = render()
        expect(
          /import\s*\{[^}]*buildRateLimiter/.test(source),
          `${target} uses buildRateLimiter and never imports it`,
        ).toBe(true)
        expect(
          new RegExp(
            `import\\s*\\{[^}]*${STORE.factory}[^}]*\\}\\s*from\\s*['"][^'"]*${STORE.module}`,
          ).test(source),
          `${target} constructs ${STORE.factory} without importing it from ${STORE.module}`,
        ).toBe(true)
        expect(source, `${target} imports the factory and never calls it`).toContain(
          `${STORE.factory}(`,
        )
      })
    })
  }
})

describe('the emitted entry calls one limiter builder (B-262)', () => {
  // The emitter had two branches — `createRateLimiterWeb` for no store, `createDurableRateLimiterWeb`
  // for a store — and the second returns a Promise where the first does not. That is what forced
  // `rateLimitCheckFragment` to decide, per config, whether to emit `await`, and a call site that
  // changes shape with the config is what produced B-257's missing one.
  //
  // `buildRateLimiter` has one signature and is always async, so the call site stops having a
  // decision to make. These cases assert that the emitted entry reflects that.
  for (const [target, render] of DURABLE_ENTRIES) {
    it(`test_${target.replace(/-/g, '_')}_awaits_unconditionally`, () => {
      const source = render()
      expect(
        /await\s+RATE_LIMIT\(/.test(source),
        `${target} does not await the limiter; a Promise read for \`limited\` is always falsy`,
      ).toBe(true)
    })
  }

  it('test_the_no_store_entry_awaits_too', () => {
    // The case that used to be synchronous. If it still emits a bare call, the two shapes have not
    // been unified and the decision the call site was making is still there.
    const source = renderCloudflareWorkerEntry({ ssrStreaming: false, rateLimit: LIMIT })
    expect(
      /await\s+RATE_LIMIT\(/.test(source),
      'the no-store entry emits a synchronous call, so the call site still branches on the config',
    ).toBe(true)
  })
})
