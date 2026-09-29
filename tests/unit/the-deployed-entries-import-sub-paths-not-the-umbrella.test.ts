/**
 * No emitted entry may import the umbrella the framework schedules for removal.
 *
 * `packages/theo/src/server/index.ts` warns in the framework's own words:
 *
 *     [theokit] umbrella import "theokit/server" is DEPRECATED. Use sub-paths
 *     (theokit/server/<domain>): auth, jobs, http, security, observability, etc.
 *     Removal scheduled for 0.x+2.
 *
 * A warning is a nuisance; a scheduled REMOVAL is a dated failure. An entry importing the umbrella stops
 * loading on the release that drops it, before a request exists — the same failure mode the react-dom
 * import had on Bun, where a link-time error made a whole bundle unloadable.
 *
 * Measured 2026-09-28 by running the emitted Deno entry on Deno 2.9.5: the warning printed on every
 * start, and `deno-deploy.ts:40` and `:102` were the only adapter emitting it. Four siblings already use
 * sub-paths, so the mapping the fix needs was already written down.
 *
 * ## Why a sweep and not a case for Deno
 *
 * One adapter out of six had this, which is the shape this repository keeps paying for — `B-315`'s own
 * note calls it "the same option threaded correctly by two adapters and forgotten by three". A per-target
 * assertion has to be written again for the next adapter; a sweep is already written for it.
 *
 * ## Why the specifier is matched with an optional `npm:` prefix
 *
 * Deno's emitted specifier is `npm:theokit/server`. A pattern written as `from 'theokit/server'` matched
 * NOTHING while the string was present in six files — measured, and the ruler was the thing that was
 * wrong. The prefix is part of what has to be caught.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ADAPTERS = resolve(__dirname, '../../packages/theo/src/adapters')

/** Source with comments removed, so a docblock example is not read as an import. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every adapter source file, so a target added later is swept without editing this test. */
function adapterSources(): { file: string; source: string }[] {
  return readdirSync(ADAPTERS)
    .filter((f) => f.endsWith('.ts'))
    .map((file) => ({ file, source: code(readFileSync(resolve(ADAPTERS, file), 'utf-8')) }))
}

/** The umbrella specifier, with or without Deno's `npm:` prefix, in either quote style. */
const UMBRELLA = /from ['"](?:npm:)?theokit\/server['"]/g

describe('the deployed entries import sub-paths, not the umbrella', () => {
  it('no adapter emits the umbrella specifier', () => {
    const offenders = adapterSources()
      .map(({ file, source }) => ({ file, hits: source.match(UMBRELLA) ?? [] }))
      .filter(({ hits }) => hits.length > 0)
      .map(({ file, hits }) => `${file}: ${hits.length}x ${hits[0]}`)

    expect(
      offenders,
      'an emitted entry imports `theokit/server`, which the framework schedules for removal — that ' +
        'deployment stops loading on the release that drops it, before a request exists',
    ).toEqual([])
  })

  it('the sweep actually reads the adapters', () => {
    // COUNTERPROOF. `toEqual([])` also passes over a directory the sweep failed to read, over a comment
    // stripper that ate the whole file, and over a regex that matches nothing. Three of this session's
    // false greens had exactly that shape, so the probe is proved before its result is believed.
    const sources = adapterSources()

    expect(sources.length).toBeGreaterThan(5)
    expect(sources.map((s) => s.file)).toContain('deno-deploy.ts')
    // The sub-path form must be found, or the regex above is not looking where the imports are.
    const subPaths = sources.flatMap(
      ({ source }) => source.match(/from ['"](?:npm:)?theokit\/server\/[a-z-]+['"]/g) ?? [],
    )
    expect(
      subPaths.length,
      'no sub-path import was found in any adapter, so this file is not reading emitted imports at all',
    ).toBeGreaterThan(3)
  })

  it('catches the umbrella under both spellings', () => {
    // COUNTERPROOF for the pattern itself, which is where the original measurement went wrong.
    expect("import { x } from 'npm:theokit/server'".match(UMBRELLA)).toHaveLength(1)
    expect('import { x } from "theokit/server"'.match(UMBRELLA)).toHaveLength(1)
    // And it must NOT fire on a sub-path, which is the correct form.
    expect("import { x } from 'npm:theokit/server/scan'".match(UMBRELLA)).toBeNull()
  })
})
