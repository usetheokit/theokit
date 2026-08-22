/**
 * A build that validates configuration and then drops it says nothing.
 *
 * `theo.config.ts` declares `rateLimit`, `security.cors`, `security.csrf`,
 * `security.disallowed`, `security.headers` and `serialization`. Every one of
 * them parses, every one of them validates, and on the six Web-standards deploy
 * adapters most are still not applied — the generated entry builds
 * `executeRoute`'s context from a subset of its fields and the rest fall back to
 * hard-coded defaults (usetheokit/theokit#410). `security.cors` is read only by
 * the dev server, so no production target serves a CORS header at all
 * (usetheokit/theokit#409).
 *
 * `security.headers` left that list on 2026-08-21 (B-026): all six entries now
 * carry the block as a literal and apply the built baseline to every response.
 * The proof is not this file — a declaration cannot verify itself — it is
 * `adapter-security-headers.test.ts`, which imports each emitted entry, drives a
 * request through it and reads the headers off the Response that comes back.
 *
 * This is the failure mode `adapters/types.ts` already names for streaming:
 * "a target silently listed for something nobody exercised". The answer there
 * was to make each adapter *declare* the capability, defaulting to no. This
 * file holds the same contract for configuration.
 *
 * **What this cannot do** is prove the declaration is true. `appliesConfig` is
 * a claim the adapter makes about its own emitted handler, and a wrong claim
 * here is indistinguishable from a right one — the same limit
 * `adapter-streaming-contract.test.ts` states about `streamsResponses`. What
 * it does do is make the claim exist, and make dropping a concern a visible
 * edit rather than an omission nobody notices.
 */
import { describe, it, expect } from 'vitest'

import {
  CONFIG_CONCERNS,
  findUnappliedConfig,
  describeUnappliedConfig,
  warnUnappliedConfig,
} from '../../packages/theo/src/adapters/config-support.js'
import { resolveAdapter } from '../../packages/theo/src/adapters/registry.js'
import type { BuildTarget, ConfigConcern } from '../../packages/theo/src/adapters/types.js'
import { VALID_TARGETS } from '../../packages/theo/src/adapters/types.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'
import { theoConfigSchema } from '../../packages/theo/src/config/schema.js'

/**
 * Fixtures go through the real schema instead of a cast.
 *
 * The first version of this file cast its objects with `as unknown as
 * TheoConfig` and wrote `disallowed: ['/admin']`. `security.disallowed` is a
 * rule set (`{ routes, behavior }`), not a list of paths — so the fixture
 * encoded the same wrong shape the implementation had assumed, agreed with it,
 * and passed. The workspace typecheck caught what 20 green tests could not.
 * Parsing here means a fixture that does not exist cannot be written.
 */
function parseConfig(input: Record<string, unknown>): TheoConfig {
  return theoConfigSchema.parse(input)
}

/**
 * What each target's emitted handler actually applies, read from source on
 * 2026-08-21 rather than assumed:
 *
 * - `node` — `cli/commands/start/index.ts` builds the executor context with
 *   `rateLimiter`, `csrfMode`, `disallowed`, `transformer` and `pluginRunner`,
 *   and `request-handler.ts` applies the security headers. It contains no
 *   reference to CORS at all, which is why `cors` is absent from its list.
 * - the six Web adapters — the generated entry calls `createWebShim` then
 *   `executeRoute` with routes, loader and `serverDir`. Route policy, file
 *   middleware and Zod validation run because they live inside `executeRoute`.
 *   Each applies `securityHeaders` on top, at one choke point per entry, and
 *   since #410 each carries the declared `csrf` mode and `disallowed`
 *   escalation as build-time literals — CSRF enforcement always ran, but at
 *   the executor's `'strict'` default rather than at the configured mode, so a
 *   `csrf: 'off'` app answered 403 on a deploy target and 200 locally.
 *
 *   `serialization` and `plugins` are still absent, and not by oversight: both
 *   carry FUNCTIONS from `theo.config.ts`, which a literal cannot express and a
 *   deployed function has no config file to load. Closing them needs the entry
 *   to import app modules, which is a build-graph decision of its own (#425).
 * - `static` — emits no request handler.
 * - `theo-cloud` — emits no request handler either, but for a different
 *   reason: the runtime is TheoCloud's and this build cannot answer for it.
 */
const EXPECTED: Record<BuildTarget, readonly ConfigConcern[] | 'runtime-not-emitted-here'> = {
  node: ['rateLimit', 'csrf', 'disallowed', 'serialization', 'plugins', 'securityHeaders', 'cors'],
  vercel: ['securityHeaders', 'csrf', 'disallowed'],
  cloudflare: ['securityHeaders', 'csrf', 'disallowed'],
  netlify: ['securityHeaders', 'csrf', 'disallowed'],
  bun: ['securityHeaders', 'csrf', 'disallowed'],
  'deno-deploy': ['securityHeaders', 'csrf', 'disallowed'],
  'aws-lambda': ['securityHeaders', 'csrf', 'disallowed'],
  static: [],
  'theo-cloud': 'runtime-not-emitted-here',
}

describe('every deploy target declares which configuration its handler applies', () => {
  for (const target of VALID_TARGETS) {
    it(`${target} declares appliesConfig`, async () => {
      const adapter = await resolveAdapter(target)
      expect(adapter.appliesConfig ?? []).toEqual(EXPECTED[target])
    })
  }
})

describe('a declared concern the target drops is named, not swallowed', () => {
  const fullConfig = parseConfig({
    rateLimit: { windowMs: 60_000, max: 10 },
    security: {
      // `origins`, plural -- the second shape this file got wrong under a cast.
      cors: { origins: '*' },
      csrf: 'warn',
      disallowed: { routes: ['/admin'], behavior: 'raise' },
    },
    serialization: 'superjson',
  })

  it('reports every dropped concern on a Web adapter', async () => {
    const adapter = await resolveAdapter('vercel')
    // `csrf` and `disallowed` left this list in #410: both are plain data, so the build bakes
    // them into the emitted entry as literals. `cors`, `rateLimit` and `serialization` remain —
    // the last two for the same reason `plugins` does, that they carry FUNCTIONS a literal cannot
    // express (#425).
    expect(
      [...findUnappliedConfig(fullConfig, adapter)].sort((a, b) => a.localeCompare(b)),
    ).toEqual(['cors', 'rateLimit', 'serialization'])
  })

  it('reports nothing on node, which now applies every concern it parses', async () => {
    // This read `['cors']` until #409, and that was the honest answer: `security.cors` had one
    // consumer, Vite's `configureServer` hook, so an app that worked cross-origin under
    // `theokit dev` stopped working the moment `theokit start` served it.
    const adapter = await resolveAdapter('node')
    expect(findUnappliedConfig(fullConfig, adapter)).toEqual([])
  })

  it('does not report a key whose declared value equals the deployed fallback', async () => {
    // `csrf: 'strict'` and `serialization: 'json'` are what an unwired target
    // does anyway. The outcome matches the file, so there is nothing to warn
    // about -- a warning here would train the operator to ignore the block.
    const coincident = parseConfig({
      security: { csrf: 'strict' },
      serialization: 'json',
    })
    const adapter = await resolveAdapter('vercel')
    expect(findUnappliedConfig(coincident, adapter)).toEqual([])
  })

  it('reports nothing when the config declares nothing', async () => {
    // What "nothing" is after parsing: the schema fills `serialization` and
    // `security.csrf` with their defaults, so an app whose author wrote no
    // security block still arrives here with both set. The empty object never
    // reaches this function in production -- `buildCommand` loads the config
    // through the schema.
    const parsedDefaults = parseConfig({})
    const adapter = await resolveAdapter('vercel')
    expect(findUnappliedConfig(parsedDefaults, adapter)).toEqual([])
  })

  it('reports nothing for a target whose runtime this build does not emit', async () => {
    const adapter = await resolveAdapter('theo-cloud')
    expect(findUnappliedConfig(fullConfig, adapter)).toEqual([])
  })
})

describe('the message names what to do, not merely what is wrong', () => {
  it('names the target, every dropped key, and the tracking issue', () => {
    const message = describeUnappliedConfig('vercel', ['rateLimit', 'cors'])

    expect(message).toContain('vercel')
    // The config keys as the operator wrote them, so the message can be
    // grepped against their own file.
    expect(message).toContain('rateLimit')
    expect(message).toContain('security.cors')
    // An instruction, not an observation. The fifth metric of the DX benchmark
    // is that a failure names the next action.
    expect(message).toMatch(/remove it|deploy to `node`|track/i)
    expect(message).toContain('#410')
  })

  it('does not tell a node build to deploy to node', async () => {
    // The degenerate advice this replaced: building for `node` with a dropped key printed
    // "deploy to `node`, which applies all of the above except …" -- an instruction to do what you
    // are already doing.
    //
    // The example used to be `security.cors`, because until #409 NO production target applied it.
    // `node` does now, so `APPLIED_BY_NO_TARGET` is empty and that phrasing is unreachable by
    // construction. The mechanism is kept rather than deleted because the state it describes is
    // reachable again the moment a concern is dropped everywhere -- and the assertion that
    // survives is the one this test is actually named for.
    const message = describeUnappliedConfig('node', ['cors'])

    expect(message).not.toMatch(/build for `node`/)
  })

  it('points a Web target at the one that does apply the key', () => {
    const message = describeUnappliedConfig('vercel', ['rateLimit', 'cors'])

    // Grouped into one sentence because both keys now have the same answer. `security.cors`
    // joined it in #409 — before that the advice for a Vercel build had nowhere to point, because
    // the key reached no production target at all, and it was rendered in a separate clause.
    expect(message).toContain('rateLimit, security.cors: build for `node`')
  })

  it("the advice's claim about node matches what node declares", async () => {
    // This guarded a hand-maintained `APPLIED_BY_NO_TARGET` constant against drifting from the
    // adapter, which #409 removed by deriving the answer from `nodeAdapter.appliesConfig` instead.
    //
    // It is NOT vacuous now that both read the same source: what it still catches is the
    // derivation reaching the message inverted or not at all — a rendering bug rather than a
    // drift one. Stated here because a test whose comment describes a purpose it no longer serves
    // is worse than no comment.
    const node = await resolveAdapter('node')
    const applied = node.appliesConfig
    if (applied === undefined || applied === 'runtime-not-emitted-here') {
      throw new Error('the node adapter must declare what it applies')
    }
    for (const concern of CONFIG_CONCERNS) {
      const nodeApplies = applied.includes(concern)
      const claimedNowhere = describeUnappliedConfig('vercel', [concern]).includes(
        'no production target applies',
      )
      expect(claimedNowhere).toBe(!nodeApplies)
    }
  })

  it('says nothing when nothing was dropped', () => {
    expect(describeUnappliedConfig('node', [])).toBe('')
  })
})

describe('the concern list is closed', () => {
  it('every declared concern is a known one', async () => {
    for (const target of VALID_TARGETS) {
      const adapter = await resolveAdapter(target)
      const declared = adapter.appliesConfig
      if (declared === undefined || declared === 'runtime-not-emitted-here') continue
      for (const concern of declared) {
        expect(CONFIG_CONCERNS).toContain(concern)
      }
    }
  })
})

describe('the build emits the warning, and stays quiet when there is nothing to say', () => {
  const declaresRateLimit = parseConfig({ rateLimit: { windowMs: 60_000, max: 10 } })

  it('logs once, naming the target, when a declared key is dropped', async () => {
    const adapter = await resolveAdapter('cloudflare')
    const lines: string[] = []

    warnUnappliedConfig(declaresRateLimit, adapter, 'cloudflare', (message) => lines.push(message))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('cloudflare')
    expect(lines[0]).toContain('rateLimit')
  })

  it('logs nothing when the target applies what was declared', async () => {
    const adapter = await resolveAdapter('node')
    const lines: string[] = []

    warnUnappliedConfig(declaresRateLimit, adapter, 'node', (message) => lines.push(message))

    expect(lines).toEqual([])
  })

  it('logs nothing for a target whose runtime this build does not emit', async () => {
    const adapter = await resolveAdapter('theo-cloud')
    const lines: string[] = []

    warnUnappliedConfig(declaresRateLimit, adapter, 'theo-cloud', (message) => lines.push(message))

    expect(lines).toEqual([])
  })
})
