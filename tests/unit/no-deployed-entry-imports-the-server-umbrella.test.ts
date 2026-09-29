/**
 * No deployed entry may import the `theokit/server` umbrella.
 *
 * The umbrella re-exports the whole server half, and one of the things down that graph is
 * `@swc/core`, whose Linux build is a native `.node` addon. Any bundler asked to follow the import
 * stops there.
 *
 * Measured twice, on two platforms, from one cause:
 *
 *     wrangler deploy (Cloudflare, 2026-09-26)
 *       ✘ No loader is configured for ".node" files:
 *         @swc/core-linux-x64-gnu/swc.linux-x64-gnu.node
 *
 *     vite build --ssr (the Vercel function, same day)
 *       [commonjs--resolver] @swc/core-linux-x64-gnu/swc.linux-x64-gnu.node: Failed to parse
 *       source for import analysis because the content contains invalid JS syntax
 *
 * Bisected on Cloudflare with the real oracle: a worker whose ONLY line was
 * `import { matchRoute } from 'theokit/server'` pulled the addon in. The narrow subpaths probe
 * clean, and the umbrella prints its own deprecation notice on import.
 *
 * ## Why a sweep, and why it includes a file already fixed
 *
 * Cloudflare's main import was corrected the same day, and **the fix missed the rate-limit
 * fragment** in the same file — one `import { createRateLimiterWeb } from 'theokit/server'`, emitted
 * only when a project declares a limit. `my-test` declares none, so the deploy that validated the
 * target never emitted the line and nothing said the hole was there. That is `testing.md § 4.1` in
 * its own words: a fix changes a boundary, and the half you were not looking at is the half you
 * moved.
 *
 * So the assertion is over EVERY adapter and every fragment it can emit, not over the two
 * invocations a passing project happens to take.
 *
 * ## Where each symbol lives
 *
 * Resolved by importing the built subpaths and asking which one carries the name, rather than by
 * reading an index file:
 *
 *     theokit/server/scan        scanServerRoutes, scanWebSocketRoutes, matchRoute,
 *                                compilePattern, createProductionLoader
 *     theokit/server/http        executeRoute, extractTraceIdFromRequest, TRACE_HEADER,
 *                                createCorsWebHandler, injectModulePreloads
 *     theokit/server/rate-limit  createRateLimiterWeb, resolveClientIpFromRequest
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ADAPTERS_DIR = join(import.meta.dirname, '../../packages/theo/src/adapters')

const ADAPTERS = readdirSync(ADAPTERS_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => [f, readFileSync(join(ADAPTERS_DIR, f), 'utf8')] as const)

/** Source with comments removed, so prose naming the import is not read as the import. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * An emitted import of the umbrella, and ONLY of the umbrella.
 *
 * `theokit/server/scan` must not match. A pattern ending at `server` would match every narrow
 * subpath too and report the fix as the defect, which is the inverse mistake and the more expensive
 * one — it sends the next reader to undo a correct change.
 */
const UMBRELLA = "from 'theokit/server'"

/**
 * A plain substring, not a regex, because `prefer-includes` is right here and the semantics are
 * identical: the pattern carries no anchor and no metacharacter. The subpath exclusion survives for
 * a reason worth stating — `from 'theokit/server/scan'` does not CONTAIN `from 'theokit/server'`,
 * since the closing quote must follow `server` immediately. The counterproof below pins that.
 */
function emitsUmbrella(source: string): boolean {
  return code(source).includes(UMBRELLA)
}

describe('no deployed entry imports the server umbrella', () => {
  it('test_the_sweep_read_the_adapters', () => {
    // COUNTERPROOF FIRST: an empty list passes the case below trivially.
    expect(ADAPTERS.length).toBeGreaterThanOrEqual(6)
    expect(ADAPTERS.map(([name]) => name)).toContain('vercel.ts')
    expect(ADAPTERS.map(([name]) => name)).toContain('cloudflare.ts')
  })

  it('test_no_adapter_emits_the_umbrella', () => {
    const offenders = ADAPTERS.filter(([, src]) => emitsUmbrella(src)).map(([name]) => name)

    expect(
      offenders,
      "these adapters emit `import … from 'theokit/server'` into a deployed entry. The umbrella " +
        "re-exports the whole server half, and @swc/core's native .node addon is down that graph — " +
        'wrangler refuses to bundle it and vite refuses to parse it, so the deploy fails before a ' +
        'request is ever served',
    ).toEqual([])
  })

  it('test_the_pattern_does_not_flag_a_narrow_subpath', () => {
    // COUNTERPROOF for the matcher. A pattern ending at `server` matches every subpath and would
    // report the fix as the defect — the expensive direction, because it sends the next reader to
    // revert a correct change.
    expect(emitsUmbrella("import { matchRoute } from 'theokit/server/scan'")).toBe(false)
    expect(emitsUmbrella("import { executeRoute } from 'theokit/server/http'")).toBe(false)
    expect(emitsUmbrella("import { createRateLimiterWeb } from 'theokit/server/rate-limit'")).toBe(
      false,
    )
    expect(emitsUmbrella("import { matchRoute } from 'theokit/server'")).toBe(true)
  })

  it('test_the_matcher_is_not_satisfied_by_prose', () => {
    // The docblock above quotes the forbidden import to explain it. Without stripping comments this
    // very file would make every adapter that documents the fix look like an offender.
    const commentOnly = "/** It used to say from 'theokit/server' here. */\nexport const x = 1\n"

    expect(emitsUmbrella(commentOnly)).toBe(false)
  })
})
