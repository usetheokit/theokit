/**
 * A build that validates configuration and then drops it says nothing.
 *
 * `theo.config.ts` declares `rateLimit`, `security.cors`, `security.csrf`,
 * `security.disallowed` and `serialization`. Every one of them parses, every
 * one of them validates, and on the six Web-standards deploy adapters not one
 * of them is applied — the generated entry builds `executeRoute`'s context
 * from a subset of its fields and the rest fall back to hard-coded defaults
 * (usetheokit/theokit#410). `security.cors` is read only by the dev server, so
 * no production target serves a CORS header at all
 * (usetheokit/theokit#409).
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
 *   `executeRoute` with routes, loader and `serverDir`. CSRF, route policy,
 *   file middleware and Zod validation run because they live inside
 *   `executeRoute`; none of the five configurable concerns reach it.
 * - `static` — emits no request handler.
 * - `theo-cloud` — emits no request handler either, but for a different
 *   reason: the runtime is TheoCloud's and this build cannot answer for it.
 */
const EXPECTED: Record<BuildTarget, readonly ConfigConcern[] | 'runtime-not-emitted-here'> = {
  node: ['rateLimit', 'csrf', 'disallowed', 'serialization', 'plugins', 'securityHeaders'],
  vercel: [],
  cloudflare: [],
  netlify: [],
  bun: [],
  'deno-deploy': [],
  'aws-lambda': [],
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
    expect(
      [...findUnappliedConfig(fullConfig, adapter)].sort((a, b) => a.localeCompare(b)),
    ).toEqual(['cors', 'csrf', 'disallowed', 'rateLimit', 'serialization'])
  })

  it('reports only cors on node, which is the one everybody assumes it has', async () => {
    const adapter = await resolveAdapter('node')
    expect(findUnappliedConfig(fullConfig, adapter)).toEqual(['cors'])
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
