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
 *     netlify       yes                           yes
 *     aws-lambda    yes                           yes
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

/**
 * Agents must be CONFIGURED or the fragment is never emitted at all.
 *
 * `deployedAgentsFragment` returns EMPTY without a source, so a renderer called with `{}` produces an
 * entry with no `scanAgents` line — and the pairing assertion would pass over an entry that does not
 * exercise the path. The same trap the Cloudflare preload tests hit: without `assetsMap` they went
 * green on unfixed code.
 */
const WITH_AGENTS = { agentsDir: 'src/server/agents', serverDir: 'src/server' } as const

const ENTRIES: readonly (readonly [string, string])[] = [
  ['vercel', renderVercelFunctionEntry(WITH_AGENTS)],
  ['aws-lambda', renderAwsLambdaEntry(WITH_AGENTS)],
  ['netlify', renderNetlifyFunction(WITH_AGENTS)],
  ['deno-deploy', renderDenoEntry(3000, WITH_AGENTS)],
]

/** Source with comments removed, so prose naming an identifier is not read as code. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('a generated entry declares every name it uses', () => {
  it('test_the_agents_branch_is_actually_emitted', () => {
    // COUNTERPROOF FIRST. Without a configured agents dir the fragment is EMPTY, so the pairing
    // below would hold trivially over entries that never reference `cwd`. Measured when written:
    // all four emit the scan.
    const missing = ENTRIES.filter(([, src]) => !code(src).includes('scanAgents(')).map(([n]) => n)

    expect(
      missing,
      'these renderers emitted no agents branch, so the case below proves nothing',
    ).toEqual([])
  })

  it('test_an_entry_referencing_cwd_also_declares_it', () => {
    const offenders = ENTRIES.filter(([, src]) => {
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
