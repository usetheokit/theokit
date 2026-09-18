import { existsSync, readFileSync } from 'node:fs'

import { beforeAll, describe, expect, it } from 'vitest'

import { OUT, currentCapabilityMap, declaredEntries } from '../../scripts/capability-map.mjs'

/**
 * The committed capability map agrees with the package it describes.
 *
 * A generated document nobody regenerates is a hand-written one with extra steps, and the copy is
 * always the half that goes stale. This is the `--check` the generator offers, run where CI already
 * looks — the repository's own pattern: `subpath-surface.test.ts` is the gate over
 * `generate-reexports.mts` for the same reason.
 *
 * What the map prevents is measured in `apps/theocode`: `applySubagentMemory` lives on `./config` and
 * not the root, importing it from the root type-checks against the bundled declaration, and it throws
 * at run time. Twenty subpaths and no inventory means a consumer guesses, and the guess fails in the
 * worst order — after the type-checker said yes.
 */

let rendered: string

describe('the committed capability map is what the package implies', () => {
  beforeAll(() => {
    rendered = currentCapabilityMap()
  }, 120_000)

  it('test_the_map_EXISTS_and_is_published', () => {
    // It is in `files`; a map that ships nowhere is the state this replaced, where the README pointed
    // at a path that was empty after install.
    expect(
      existsSync(OUT),
      `${OUT} does not exist — run 'npx tsx scripts/capability-map.mts'`,
    ).toBe(true)
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { files?: string[] }
    expect(
      pkg.files ?? [],
      "'docs' is not in the manifest's files — the map would not be published",
    ).toContain('docs')
  })

  it('test_the_scan_covered_every_published_entry', () => {
    // COUNTERPROOF. `currentCapabilityMap` throws on an unbuilt entry rather than skipping it, so a
    // partial build cannot produce a map this test then agrees with.
    const entries = declaredEntries()
    expect(entries.length, 'no published entry was resolved from the manifest').toBeGreaterThan(5)
    const headings = (rendered.match(/^## /gm) ?? []).length
    expect(headings, 'the rendered map names fewer entries than the manifest declares').toBe(
      entries.length,
    )
  })

  it('test_the_committed_map_has_NOT_drifted', () => {
    const committed = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    expect(
      committed === rendered,
      'docs/capability-map.md has drifted from the package. Re-run ' +
        "'npx tsx scripts/capability-map.mts' and commit the result. It is generated, never edited: a " +
        'hand-kept copy of an export list is the copy that goes stale.',
    ).toBe(true)
  })
})
