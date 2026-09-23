import { describe, expect, it } from 'vitest'

import { rateLimitVirtualModule } from '../../packages/theo/src/vite-plugin/rate-limit-virtual-module.js'

/**
 * B-262 / T1.1 — the seam that lets a deployed entry IMPORT its limiter instead of carrying a
 * transcription of it.
 *
 * 973 of 6077 lines under `adapters/` are lines whose entire content is an emitted string, and the
 * compiler cannot see any of them. B-257 paid for that directly: `createDurableRateLimiterWeb` was
 * used at module scope and never imported, so the generated entry threw when it LOADED, and `tsc`
 * said nothing. An entry that IMPORTS gets that defect refused by the compiler for free.
 *
 * ## Why the id carries the target
 *
 * A virtual module resolves inside THIS build. The specifier it emits has to resolve wherever the
 * entry finally runs, and those are different resolvers: `deno-deploy.ts:57` is the only caller
 * passing `importPrefix: 'npm:'`, because Deno resolves `theokit/server/rate-limit` and nothing
 * else. One id with one specifier would work on five targets and fail the sixth at LOAD — which is
 * the defect class this whole item exists to remove, reintroduced by its own fix.
 */
describe('the rate-limit virtual module resolves (B-262, T1.1)', () => {
  it('test_it_resolves_the_id_it_owns', () => {
    const plugin = rateLimitVirtualModule()
    expect(plugin.resolveId('@theo/rate-limit?target=cloudflare')).toBe(
      '\0@theo/rate-limit?target=cloudflare',
    )
  })

  it('test_an_unrelated_id_is_left_alone', () => {
    // A plugin that captured ids it does not own would break every other resolver in the chain,
    // and the failure would surface as a module that cannot be found somewhere unrelated.
    const plugin = rateLimitVirtualModule()
    expect(plugin.resolveId('anything-else')).toBeUndefined()
    expect(plugin.resolveId('@theo/actions')).toBeUndefined()
  })

  it('test_the_deno_target_gets_the_npm_specifier', () => {
    // EC-1. `deno-deploy.ts:57` passes `importPrefix: 'npm:'` today for exactly this reason.
    const source = rateLimitVirtualModule().load('\0@theo/rate-limit?target=deno-deploy')
    expect(source, 'the deno module emitted nothing').toBeDefined()
    expect(source).toContain('npm:theokit/server/rate-limit')
  })

  it('test_every_other_target_gets_the_bare_specifier', () => {
    // The inverse of the case above: a prefix applied everywhere would break the five that resolve
    // the bare specifier, so the test asserts the absence as deliberately as it asserts the presence.
    const source = rateLimitVirtualModule().load('\0@theo/rate-limit?target=cloudflare')
    expect(source).toContain("from 'theokit/server/rate-limit'")
    expect(source, 'the npm: prefix leaked onto a target that does not want it').not.toContain(
      'npm:',
    )
  })

  it('test_it_loads_only_the_id_it_resolved', () => {
    const plugin = rateLimitVirtualModule()
    expect(plugin.load('@theo/rate-limit?target=cloudflare')).toBeUndefined()
    expect(plugin.load('\0something-else')).toBeUndefined()
  })

  it('test_an_id_with_no_target_is_refused_rather_than_guessed', () => {
    // A missing target has no safe default: guessing the bare specifier breaks deno, guessing the
    // prefix breaks the other five. Refusing names the mistake at build time, where it is cheap.
    const plugin = rateLimitVirtualModule()
    expect(() => plugin.load('\0@theo/rate-limit')).toThrow(/target/i)
  })
})
