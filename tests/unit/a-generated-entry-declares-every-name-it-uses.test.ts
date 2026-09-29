/**
 * A generated entry must declare the names its fragments reference.
 *
 * `scannedFromLoaderCache()` hardcodes `projectRoot: 'cwd'`, so the agents fragment emits
 * `scanAgents(cwd, …)`. That is an implicit contract on its host — *"you declare `cwd`"* — and four
 * adapters call it. Three declare it. Vercel did not.
 *
 * Measured on the live deployment, 2026-09-26 (B-263), then reproduced by invoking the bundled
 * function locally:
 *
 *     GET /api/agents/chat  ->  500, FUNCTION_INVOCATION_FAILED
 *
 *     ReferenceError: cwd is not defined
 *       at routeRequest (index.mjs:44986:48)
 *       at handler (index.mjs:44921:71)
 *
 * The sweep when this was written:
 *
 *     adapter       uses scannedFromLoaderCache   emits `const cwd`
 *     vercel        yes                           NO        <- the defect
 *     netlify       yes                           yes    (until B-339: it bakes now, like vercel)
 *     aws-lambda    yes                           yes    (until B-344: it bakes now, like the two above)
 *     deno-deploy   yes                           yes
 *     bun           no (names its loader differently, by decision)
 *     cloudflare    no (bakes its agents, #367)
 *
 * ## Why nothing caught it
 *
 * The reference is inside the AGENTS branch, which only runs for `/api/agents/<name>`. Every test of
 * this entry asserted on the emitted text, and the text is correct — `scanAgents(cwd, "…")` is
 * exactly what the fragment is supposed to produce. What was missing was the declaration, in a
 * different part of the same file. A free variable in generated code is invisible to `tsc`, because
 * the generated code is a STRING at type-check time.
 *
 * ## What is asserted
 *
 * The pairing, over every renderer this repository exports, in the OUTPUT rather than in the source.
 * A source grep cannot see it: the reference comes from an imported fragment and the declaration from
 * the adapter, so the two live in different files and only the emitted entry has both.
 */
import { describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'
// The string-aware stripper, shared. Seven files carried a byte-identical regex copy that read
// `"/*"` in netlify.ts as a comment opener and deleted 36% of that file (B-338).
import { withoutComments as code } from './_helpers/adapter-source.js'

/**
 * Agents must be CONFIGURED or the fragment is never emitted at all.
 *
 * `deployedAgentsFragment` returns EMPTY without a source, so a renderer called with `{}` produces an
 * entry with no `scanAgents` line — and the pairing assertion would pass over an entry that does not
 * exercise the path. The same trap the Cloudflare preload tests hit: without `assetsMap` they went
 * green on unfixed code.
 */
// A ROUTE is part of the fixture, and it was not until 2026-09-29. Without one, `renderBakedRoutes([])`
// emits an empty table and every name used only on the baked path is invisible to this file — which is
// how `netlify` shipped an entry calling `compilePattern(...)` without importing it, while these four
// cases passed. The guard covered the adapter and its INPUT excluded the case (B-339).
// WHAT THIS FILE ACTUALLY CHECKS, because its name says more than it does.
//
// Every case below is about ONE identifier: `cwd`. The name reads as a general guarantee — that a
// generated entry declares every name it uses — and on 2026-09-29 a reader took it that way and was
// wrong: `netlify` shipped an entry calling `compilePattern(...)` without importing it, the emulator
// answered `ReferenceError: compilePattern is not defined`, and these cases passed before and after.
// Reintroducing the defect deliberately did not turn them red.
//
// The general check does not exist anywhere: `adapter-entry-parses.test.ts` runs `node --check`, which
// sees syntax and not an undeclared identifier, and `/code-quality`'s symbol detector reads this
// repository's own source rather than the text an adapter emits. Registered as its own item rather than
// implied by this filename.

const WITH_AGENTS = {
  agentsDir: 'src/server/agents',
  serverDir: 'src/server',
  routes: [{ filePath: 'src/server/routes/health.ts', routePath: '/api/health', methods: ['GET'] }],
} as const

const ENTRIES: readonly (readonly [string, string])[] = [
  ['vercel', renderVercelFunctionEntry(WITH_AGENTS)],
  ['aws-lambda', renderAwsLambdaEntry(WITH_AGENTS)],
  ['netlify', renderNetlifyFunction(WITH_AGENTS)],
  ['deno-deploy', renderDenoEntry(3000, WITH_AGENTS)],
]

describe('a generated entry declares every name it uses', () => {
  /**
   * The renderers that still resolve their agents at RUNTIME, which is the population the pairing is
   * about.
   *
   * `vercel` left this set on purpose in B-319: Build Output API v3 uploads the `.func` directory as
   * it is, so `scanAgents` cannot work there at any value, and the entry bakes its agents instead.
   * Keeping it in the population would assert that a target must emit a call it is right not to emit.
   */
  const SCANNERS = ENTRIES.filter(([, src]) => code(src).includes('scanAgents('))

  it('test_the_sweep_found_the_renderers_that_scan_at_runtime', () => {
    // COUNTERPROOF FIRST. An empty population satisfies the pairing trivially, so this pins that the
    // set is non-empty AND that every deliberate absence is an expected one.
    //
    // `netlify` left this set on 2026-09-29 (B-339), for exactly the reason `vercel` left it in
    // B-319: the target began BUNDLING, so a runtime `scanAgents` has no source tree to read and its
    // agents are baked from the build's scan instead. This case failing is what surfaced the change
    // rather than letting the population shrink in silence — which is the whole reason it counts.
    // The population is SHRINKING by design, and that is worth stating rather than hiding behind a
    // number: every target that began bundling had to bake its agents, because a bundle carries no
    // source tree for a runtime scan to read. vercel left in B-319, netlify in B-339, aws-lambda in
    // B-344. `deno-deploy` is what remains — it runs from a filesystem it can read.
    //
    // When this reaches ZERO the file should be RETIRED, not relaxed to `>= 0`: the `cwd` pairing it
    // asserts is a property of runtime scanners, and a suite full of green no-ops is worse than one
    // file fewer.
    expect(SCANNERS.length).toBeGreaterThanOrEqual(1)
    expect(SCANNERS.map(([n]) => n)).toEqual(['deno-deploy'])
    expect(SCANNERS.map(([n]) => n)).not.toContain('vercel')
    expect(SCANNERS.map(([n]) => n)).not.toContain('netlify')
    expect(ENTRIES.map(([n]) => n)).toContain('vercel')
    expect(ENTRIES.map(([n]) => n)).toContain('netlify')
  })

  it('test_the_baked_target_declares_no_dead_cwd', () => {
    // The other half of B-319's consequence: `vercel` used to declare `const cwd` for the scan it no
    // longer emits. A declaration nothing reads is what `/code-quality` exists to catch, and this
    // repository introduced it two commits before removing the scan.
    const vercel = ENTRIES.find(([n]) => n === 'vercel')?.[1] ?? ''
    const body = code(vercel)

    expect(body).not.toMatch(/\bconst cwd = /)
  })

  it('test_an_entry_referencing_cwd_also_declares_it', () => {
    const offenders = SCANNERS.filter(([, src]) => {
      const body = code(src)
      return body.includes('scanAgents(cwd,') && !/\b(const|let|var)\s+cwd\s*=/.test(body)
    }).map(([name]) => name)

    expect(
      offenders,
      'these entries call `scanAgents(cwd, …)` and never declare `cwd`. The reference comes from ' +
        'the shared agents fragment and the declaration from the adapter, so nothing type-checks ' +
        'the pair — the generated code is a string at compile time. It throws ' +
        '`ReferenceError: cwd is not defined` on the first request to /api/agents/<name>',
    ).toEqual([])
  })

  it('test_the_declaration_check_is_not_satisfied_by_a_lookalike', () => {
    // COUNTERPROOF for the matcher. `serverDir` is built from `process.cwd()` in every one of these
    // entries, so a pattern matching the substring `cwd` anywhere would call every file clean —
    // including the one that was broken.
    const lookalike = 'const serverDir = resolve(process.cwd(), "src/server")\nscanAgents(cwd, "a")'

    expect(/\b(const|let|var)\s+cwd\s*=/.test(lookalike)).toBe(false)
    expect(/\b(const|let|var)\s+cwd\s*=/.test('const cwd = process.cwd()')).toBe(true)
  })
})
