/**
 * theokit#154 — the published sourcemaps must not carry the TypeScript source.
 *
 * `sourcemap: true` alone shipped `sourcesContent`, and the bundler default was never a decision
 * anyone made. Measured on this package before the fix: 652K of a 1.2M `dist` was maps (54%), and
 * the largest one embedded 303 889 bytes of original source across 48 files. Every `npm install` in
 * the ecosystem downloaded it, and anyone who depended on the package held the sources rather than
 * the bundle.
 *
 * After `sourcesContent: false`: maps 652K -> 180K, `dist` 1.2M -> 660K.
 *
 * This test exists because the fix is one line in a config file and the failure mode is silent — a
 * future `sourcemap` change, or a tsup upgrade that re-defaults the flag, restores the leak without
 * breaking anything a human would notice. It reads the BUILT artifact rather than the config, since
 * the config is the intent and `dist` is what actually gets published.
 *
 * It deliberately does NOT assert map sizes: those track the codebase and would turn every feature
 * into a red test. The invariant is the shape — mapping kept, sources gone.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const DIST = join(import.meta.dirname, '..', '..', 'dist')

function sourcemaps(): { name: string; map: { sources?: string[]; sourcesContent?: unknown[] } }[] {
  return readdirSync(DIST)
    .filter((f) => f.endsWith('.js.map'))
    .map((name) => ({
      name,
      map: JSON.parse(readFileSync(join(DIST, name), 'utf8')) as {
        sources?: string[]
        sourcesContent?: unknown[]
      },
    }))
}

describe('theokit#154 — published sourcemaps', () => {
  it('test_the_build_exists — without dist this file measures nothing', () => {
    // Anti-vacuity floor. Every assertion below iterates over the maps found in `dist`; with no
    // build there are zero maps, every loop passes trivially, and the gate reports green while
    // measuring nothing. Absence of a build is a test failure, not a silent success.
    expect(existsSync(DIST), 'run `npm run build` — without dist this gate measures nothing').toBe(
      true,
    )
    expect(sourcemaps().length, 'no .js.map in dist — nothing was measured').toBeGreaterThan(0)
  })

  it('test_no_sourcemap_embeds_the_original_typescript', () => {
    const leaking = sourcemaps()
      .filter(({ map }) => Array.isArray(map.sourcesContent) && map.sourcesContent.some(Boolean))
      .map(({ name, map }) => {
        const bytes = (map.sourcesContent ?? [])
          .filter((s): s is string => typeof s === 'string')
          .reduce((n, s) => n + s.length, 0)
        return `${name} (${bytes} bytes of source)`
      })
    expect(
      leaking,
      'these maps embed the original TypeScript. Set `sourcesContent: false` in the package\n' +
        'tsup config — the mapping is what a stack trace needs; the sources are not.',
    ).toEqual([])
  })

  it('test_the_mapping_itself_survived', () => {
    // The counterweight. `sourcemap: false` would also make the test above pass, by deleting the
    // maps entirely — and that takes the readable stack traces with it, which is the thing we chose
    // to keep. At least one map must still name the files it maps to.
    const withMapping = sourcemaps().filter(({ map }) => (map.sources?.length ?? 0) > 0)
    expect(
      withMapping.length,
      'no map carries `sources` — sourcemaps were disabled rather than slimmed, and a consumer\n' +
        'debugging against our dist lost the file/line it used to get',
    ).toBeGreaterThan(0)
  })
})
