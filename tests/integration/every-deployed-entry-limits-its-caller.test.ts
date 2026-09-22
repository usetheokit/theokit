import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'
import { BUILD_HOOK_TIMEOUT_MS, buildTheokitPackageOnce } from './_helpers/build-theokit-package.js'

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

const REPO = resolve(__dirname, '../..')
const THEO = resolve(REPO, 'packages/theo')

/** A limit small enough that two requests trip it. */
const LIMIT = { windowMs: 60_000, max: 1 } as const

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

type Target = (typeof ENTRIES)[number][0]

/** Every bare specifier the six entries emit, measured rather than assumed. */
const SPECIFIER_RE = /from '(npm:)?(theokit\/[a-z/-]+)'/g

let workspace: string

/** Resolve a published subpath the way a consumer's runtime does — through the exports map. */
function resolvePublished(subpath: string): string {
  const pkg = JSON.parse(readFileSync(join(THEO, 'package.json'), 'utf8')) as {
    exports: Record<string, { import?: string } | string>
  }
  const entry = pkg.exports[subpath]
  const spec = typeof entry === 'string' ? entry : entry?.import
  if (spec === undefined) throw new Error(`theokit does not publish "${subpath}"`)
  return resolve(THEO, spec)
}

/**
 * Rewrite every `theokit/X` to a `file://` URL under `dist`, asserting the `npm:` prefix was where
 * it belongs first. A deno entry emitting a bare specifier is its own defect, and rewriting without
 * checking would trade one blind spot for another.
 */
function toDistSpecifiers(source: string, target: Target): string {
  const prefixed = [...source.matchAll(SPECIFIER_RE)].filter((m) => m[1] === 'npm:')
  if (target === 'deno-deploy') {
    expect(prefixed.length, 'the deno entry must emit `npm:` specifiers').toBeGreaterThan(0)
  } else {
    expect(prefixed, `${target} must not emit npm: specifiers`).toHaveLength(0)
  }
  return source.replace(SPECIFIER_RE, (_all, _npm: string | undefined, bare: string) => {
    const subpath = bare.replace(/^theokit/, '.')
    return `from ${JSON.stringify(pathToFileURL(resolvePublished(subpath)).href)}`
  })
}

/** Write one entry into its own directory, so two lanes of this suite never share a path. */
function writeEntry(target: Target, source: string): string {
  const dir = mkdtempSync(join(workspace, `${target}-`))
  const file = join(dir, 'entry.mjs')
  writeFileSync(file, toDistSpecifiers(source, target))
  return file
}

interface Captured {
  handler?: (
    request: Request,
    second?: unknown,
  ) => Promise<Response | undefined> | Response | undefined
}

/**
 * Install what `bun` and `deno-deploy` read at module scope before `serve`.
 *
 * Every row is derived from the guards, not guessed: `bun.ts:49-52` exits unless `NODE_ENV` is
 * production, `:55-58` unless `Bun` exists, `:59-65` unless `Bun.version` parses to >= 1.1, and
 * `deno-deploy.ts:63-65` throws unless `Deno` exists, `:69-70` reads `Deno.env.get` and `Deno.cwd`.
 */
function installRuntimeStubs(captured: Captured): () => void {
  const g = globalThis as Record<string, unknown>
  const before = { Bun: g.Bun, Deno: g.Deno, env: process.env.NODE_ENV }
  process.env.NODE_ENV = 'production'
  g.Bun = {
    version: '1.2.0',
    file: () => ({ exists: async () => false }),
    serve: (o: { fetch?: Captured['handler'] }) => {
      captured.handler = o.fetch
      return { stop: () => undefined }
    },
  }
  g.Deno = {
    env: { get: () => undefined },
    cwd: () => workspace,
    serve: (_o: unknown, h?: Captured['handler']) => {
      captured.handler = h
      return { finished: Promise.resolve() }
    },
  }
  return () => {
    g.Bun = before.Bun
    g.Deno = before.Deno
    process.env.NODE_ENV = before.env
  }
}

/**
 * Load an emitted entry and return a driver that sends ONE request and answers with its status.
 *
 * Six targets, six calling conventions and three response shapes — which is the whole reason this
 * file exists. `cloudflare` and `netlify` export a handler returning a `Response`; `bun` and
 * `deno-deploy` export nothing and hand theirs to `serve`; `vercel` returns undefined and drains
 * into `nodeRes`; `aws-lambda` returns a v2 result object. A driver that only knew one of them
 * would report the other five as passing without exercising anything.
 */
async function load(
  target: Target,
  source: string,
): Promise<(address: string | undefined) => Promise<number>> {
  const file = writeEntry(target, source)
  const captured: Captured = {}
  const restore = installRuntimeStubs(captured)
  let mod: Record<string, unknown>
  try {
    mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  } finally {
    restore()
  }

  const url = 'https://app.test/api/thing'
  /** The header each runtime reads, so `address: undefined` really means "nothing to key on". */
  function headersFor(address: string | undefined): Record<string, string> {
    if (address === undefined) return {}
    // `cf-connecting-ip` is the header the Workers runtime writes and the only one that target
    // reads first; every other Web target falls through to the forwarded chain.
    if (target === 'cloudflare') return { 'cf-connecting-ip': address }
    return { 'x-forwarded-for': address }
  }

  if (target === 'aws-lambda') {
    const handler = mod.handler as (event: unknown) => Promise<{ statusCode: number }>
    return async (address) => {
      const result = await handler({
        requestContext: { http: { method: 'GET', path: '/api/thing', sourceIp: address } },
        headers: headersFor(address),
        rawPath: '/api/thing',
      })
      return result.statusCode
    }
  }

  if (target === 'vercel') {
    const handler = mod.default as (req: unknown, res: unknown) => Promise<void>
    return async (address) => {
      let status = 0
      const res = {
        writeHead: (s: number) => {
          status = s
          return res
        },
        flushHeaders: () => undefined,
        write: () => true,
        end: () => res,
        once: () => res,
        off: () => res,
        destroy: () => res,
      }
      await handler(
        { method: 'GET', url: '/api/thing', headers: { host: 'app.test', ...headersFor(address) } },
        res,
      )
      return status
    }
  }

  // The three Web-shaped ones, plus the two whose handler the `serve` stub captured. `second` is
  // the runtime source each expects: netlify's context, deno's serve info, bun's server.
  const exported =
    typeof mod.default === 'function'
      ? (mod.default as Captured['handler'])
      : (mod.default as { fetch?: Captured['handler'] } | undefined)?.fetch
  const handler = captured.handler ?? exported
  expect(handler, `${target} exposes no drivable handler`).toBeTypeOf('function')
  // `!` after the assertion above, not instead of it: if the handler is absent the expect()
  // has already failed the test, so nothing downstream can run on a nullish value.
  const drivable = handler!

  const second = (address: string | undefined): unknown => {
    // `bun` gets a `server` either way: `Bun.serve` always passes one, so an absent object is a
    // fixture that could not happen. What CAN happen is `requestIP` returning nothing — a
    // connection already gone — and that is the unnameable case for this target.
    if (target === 'bun')
      return { requestIP: () => (address === undefined ? undefined : { address }) }
    if (address === undefined) return undefined
    if (target === 'netlify') return { ip: address }
    if (target === 'deno-deploy') return { remoteAddr: { hostname: address } }
    return undefined
  }

  return async (address) => {
    const response = await drivable(
      new Request(url, { headers: headersFor(address) }),
      second(address),
    )
    // The four Web-shaped targets always answer with a `Response`; the one that returns nothing
    // is `vercel`, and it took the branch above. An `undefined` here is a defect in the emitted
    // entry, and `!` surfaces it as a TypeError naming this line rather than as a silent NaN.
    return response!.status
  }
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

      it(`test_${target.replace(/-/g, '_')}_refuses_a_caller_it_cannot_name`, async () => {
        const drive = await load(target, render())
        // No address anywhere: no `cf-connecting-ip`, no forwarded header, no runtime source, and
        // `trustProxy` unset. The guard must answer 503 — `rate-limit.ts:113` is
        // `clientIp.length > 0`, so reaching the limiter with `undefined` is a TypeError instead.
        expect(await drive(undefined), `${target} did not refuse an unnameable caller`).toBe(503)
      })
    })
  }
})
