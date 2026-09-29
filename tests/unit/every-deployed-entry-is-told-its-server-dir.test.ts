/**
 * An adapter that resolves `serverDir` must be told which one the project declared.
 *
 * `serverDirLiteral(opts)` is `JSON.stringify(opts.serverDir ?? 'server')`. Three adapters called it
 * and their `build()` never passed the option, so a project declaring `serverDir: 'src/server'` got
 * a deployed entry looking for `server`.
 *
 * Measured on the Vercel output of this repository's own scaffold, 2026-09-26 (B-263):
 *
 *     .vercel/output/functions/api.func/index.mjs:12
 *     const serverDir = resolve(process.cwd(), "server")
 *
 * while `my-test/theo.config.ts` declares `.serverDir('src/server')`. On Vercel that value is
 * load-bearing — line 149 of the same file is `routesCache = scanServerRoutes(serverDir)`, a
 * `readdirSync` — so every route resolves against a directory that is not there.
 *
 * ## Why this is a class and not one bug
 *
 * The comment sitting beside the defect names the same shape twice already: B-235 fixed `agentsDir`
 * for Vercel, and its own text says *"Same defect B-185 fixed for bun and deno, one target over."*
 * B-312 then fixed the same shape for the build's agents scan. Four occurrences of one mistake —
 * an option that exists, is honoured by the renderer, and is not passed by the caller — so the
 * assertion sweeps every adapter rather than naming the three that were wrong.
 *
 * ## Why the assertion is on the source
 *
 * The renderers already honour the option; passing `{ serverDir: 'x' }` to any of them emits `"x"`.
 * The defect is in `build()`, which loads a config and runs vite twice, so no test can call it with
 * one question in mind. The property that failed is *"this file's build passes the option"*, and the
 * file is where it is observable.
 *
 * Comments are stripped before matching. The docblock quoted above contains the very call this
 * searches for, and CLAUDE.md § 3.1 names exactly that trap — grep the declaration, never the word.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { serverDirLiteral } from '../../packages/theo/src/adapters/deployed-runtime-config.js'
// The string-aware stripper, shared. Seven files carried a byte-identical regex copy that read
// `"/*"` in netlify.ts as a comment opener and deleted 36% of that file (B-338).
import { withoutComments as code } from './_helpers/adapter-source.js'

const ADAPTERS_DIR = join(import.meta.dirname, '../../packages/theo/src/adapters')

const ADAPTERS = readdirSync(ADAPTERS_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => [f, readFileSync(join(ADAPTERS_DIR, f), 'utf8')] as const)

/**
 * Adapters whose emitted entry resolves a server directory at runtime.
 *
 * The population used to be `includes('serverDirLiteral(opts)')` — the adapters that call the HELPER.
 * That is a sweep keyed on the presence of the FIX, so an adapter that never adopted it is invisible to
 * the case below, and the one adapter in that state was the only broken one: measured 2026-09-29,
 * `netlify.ts` emitted `const serverDir = resolve(cwd, 'server')` as a literal and answered 404 for every
 * route on the Netlify emulator (B-338). The counterproof named the five it found and netlify was not
 * among them, so nothing about the list looked wrong.
 *
 * The question is whether the emitted entry resolves a server dir AT ALL, however it spells it.
 */
const RESOLVERS = ADAPTERS.filter(([, src]) =>
  /(?:serverDirLiteral\(opts\)|serverDir = resolve\()/.test(code(src)),
)

describe('every deployed entry is told its server dir', () => {
  it('test_the_sweep_found_the_adapters_that_resolve_a_server_dir', () => {
    // COUNTERPROOF FIRST: an empty list satisfies the case below trivially. Six adapters resolve a
    // server dir — vercel, aws-lambda, cloudflare, bun, deno-deploy and netlify. The last one is named
    // explicitly because it is the one the old population could not see, and a widened sweep that
    // silently narrowed again would look exactly like this test passing.
    expect(RESOLVERS.length).toBeGreaterThanOrEqual(6)
    expect(RESOLVERS.map(([name]) => name)).toContain('vercel.ts')
    expect(
      RESOLVERS.map(([name]) => name),
      'netlify is outside the population again, so this file cannot see the adapter it was widened for',
    ).toContain('netlify.ts')
  })

  it('test_each_one_passes_the_configured_value', () => {
    const offenders = RESOLVERS.filter(
      ([, src]) => !/serverDir:\s*config\.serverDir\b/.test(code(src)),
    ).map(([name]) => name)

    expect(
      offenders,
      'these adapters emit an entry that resolves `serverDir` and never pass the configured one, ' +
        'so a project declaring `src/server` gets a deployed entry looking for `server` — on ' +
        'Vercel that is a runtime `scanServerRoutes` against a directory that does not exist',
    ).toEqual([])
  })

  it('test_the_default_is_what_makes_the_omission_silent', () => {
    // The reason four occurrences of this shape reached production: the helper has a default that is
    // correct for the scaffold's flat layout, so an unpassed option produces a working build for the
    // common case and a broken one for every project that moved its server directory.
    expect(serverDirLiteral({})).toBe('"server"')
    expect(serverDirLiteral({ serverDir: 'src/server' })).toBe('"src/server"')
  })

  it('test_the_matcher_is_not_satisfied_by_prose', () => {
    // COUNTERPROOF for the matcher itself. The first version of the neighbouring scanner test
    // reported a clean file as an offender because a docblock mentioned the call in prose; this is
    // the same trap pointed the other way — a comment must not make an offender look clean.
    const commentOnly =
      '/** We pass serverDir: config.serverDir somewhere else. */\nexport const x = 1\n'

    expect(/serverDir:\s*config\.serverDir\b/.test(code(commentOnly))).toBe(false)
  })
})
