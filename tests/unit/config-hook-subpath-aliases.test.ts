import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import { runConfigHook } from '../../packages/theo/src/vite-plugin/config-hook.js'

/**
 * usetheokit/theokit#377 — every published subpath of `theokit` resolved to a
 * path built by string concatenation, and failed with `ENOTDIR`.
 *
 * The cause is a semantic mismatch, not a typo. A Vite alias whose `find` is a
 * **string** matches by PREFIX. Every entry in this cascade was a string, and
 * each one points at a FILE, so aliasing `theokit/client` → `client/index.ts`
 * rewrote `theokit/client/core` into `…/client/index.ts/core`. The same shape
 * broke `theokit/server/<subpath>` (noted in `server-boundary.ts`), and it broke
 * every subpath nobody had thought to list — the failure was open-ended.
 *
 * A barrel is an EXACT specifier, so it is expressed as an exact-match regex,
 * and subpaths get one generic rule instead of an enumeration that has to grow
 * with the exports map and mangles whatever is missing from it.
 *
 * ## Why this test re-implements the matcher
 *
 * Asserting the shape of the alias entries would test the implementation. What
 * matters is the id a specifier resolves to, so this mirrors Vite's documented
 * alias semantics — first entry whose `find` matches wins; a string matches by
 * prefix, a RegExp by `replace` — and asserts on the result.
 */

interface AliasEntry {
  find: string | RegExp
  replacement: string
}

// The REAL source dir: the hook picks `.ts` vs `.js` by probing for `index.ts`
// under it, so a fabricated path silently flips every replacement to `.js` and
// the assertions would grade the wrong branch.
const SRC = resolve(import.meta.dirname, '../../packages/theo/src')

function aliases(): AliasEntry[] {
  const cfg = runConfigHook({
    projectRoot: '/tmp/app',
    theoSrcDir: SRC,
    services: undefined,
    optimizeDepsInclude: [],
  })
  return (cfg.resolve as { alias: AliasEntry[] }).alias
}

/** Vite's own rule: first match wins; string is a prefix, RegExp is a replace. */
function resolveId(id: string): string {
  for (const { find, replacement } of aliases()) {
    if (typeof find === 'string') {
      if (id.startsWith(find)) return replacement + id.slice(find.length)
    } else if (find.test(id)) {
      return id.replace(find, replacement)
    }
  }
  return id
}

describe('every published subpath resolves to a real file (#377)', () => {
  it('test_the_client_core_subpath_is_not_concatenated_onto_the_barrel', () => {
    // The reported failure, exactly: `client/index.ts/core` is not a directory.
    expect(resolveId('theokit/client/core')).not.toContain('index.ts/')
    expect(resolveId('theokit/client/core')).toBe(`${SRC}/client/core`)
  })

  it('test_the_barrel_itself_still_resolves_to_the_barrel', () => {
    // The fix must not cost the common case, which is what the cascade got right.
    expect(resolveId('theokit/client')).toBe(`${SRC}/client/index.ts`)
    expect(resolveId('theokit/server')).toBe(`${SRC}/server/index.ts`)
    expect(resolveId('theokit')).toBe(`${SRC}/index.ts`)
  })

  it('test_a_server_subpath_resolves_rather_than_concatenating', () => {
    // `server-boundary.ts` records this same mangle; the boundary hides it there
    // by refusing the import first, which is a different concern from resolving.
    expect(resolveId('theokit/server/define')).toBe(`${SRC}/server/define`)
  })

  it('test_a_subpath_nobody_enumerated_resolves_too', () => {
    // The enumeration was the defect's real shape: anything missing from it was
    // silently mangled rather than reported. A generic rule has no such list.
    expect(resolveId('theokit/cache')).toBe(`${SRC}/cache`)
  })

  it('test_the_specially_mapped_subpaths_keep_their_mapping', () => {
    // Two do NOT mirror the source layout and must stay explicit: react-query
    // moved to a sibling file, and devtools' source has a /dom/ segment the
    // dist flattens. A generic rule would resolve both to the wrong place.
    expect(resolveId('theokit/react-query')).toBe(`${SRC}/client/react-query.ts`)
    expect(resolveId('theokit/devtools/entry')).toBe(`${SRC}/devtools/dom/entry.tsx`)
  })

  it('test_an_unrelated_package_sharing_the_prefix_is_untouched', () => {
    // `theokit-foo` starts with `theokit`, and a prefix rule would eat it.
    expect(resolveId('theokit-something/else')).toBe('theokit-something/else')
  })
})
