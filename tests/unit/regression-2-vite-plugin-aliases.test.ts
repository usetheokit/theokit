import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { theoPlugin } from '../../packages/theo/src/vite-plugin/index.js'

/**
 * Regression for nextjs-maturity T1.2.
 *
 * Original bug (previous session): the Vite plugin only emitted aliases
 * for `theokit/server` and bare `theokit`. Because the bare `theokit`
 * alias matched ANY path starting with `theokit/`, an import like
 * `theokit/client` produced a broken resolve (e.g.,
 * `packages/theo/index.js/client`) and Vite returned 500.
 *
 * The fix WAS the full list of subpath aliases ordered with bare last. That fixed
 * the subpaths on the list and left the class open: a string `find` still matched
 * by prefix, so `theokit/client/core` became `…/client/index.ts/core` and so did
 * every subpath nobody had listed. The same defect this file describes, one level
 * down — reported as #377 and fixed by making each entry EXACT and adding a
 * single generic rule for the rest.
 *
 * These assertions moved with it. They used to read the `find` values and their
 * order, which is the mechanism; they now read what a specifier RESOLVES to,
 * which is the property. Freezing a mechanism is what let this survive its own
 * regression test.
 *
 * NOTE: config() became async after T3.3 (zero-config-polish) — it now
 * awaits integrateUseTheoUI() for @theokit/ui auto-config. Tests await.
 */

const EXPECTED_SUBPATHS = [
  'theokit/server',
  'theokit/client',
  'theokit/react-query',
  'theokit/vite-plugin',
  'theokit/adapters/web-shim',
  'theokit/adapters/ws-shim',
  // 'theokit' (bare) — MUST be last
]

async function getAliasArray(): Promise<Array<{ find: string | RegExp; replacement: string }>> {
  const plugin = theoPlugin()
  const hook = plugin.config as (this: unknown, ...args: unknown[]) => Promise<unknown>

  const cfg = (await hook.call({}, {} as any, {} as any)) as
    | { resolve?: { alias?: unknown } }
    | undefined
  const alias = cfg?.resolve?.alias
  expect(Array.isArray(alias), 'expected alias array shape').toBe(true)
  return alias as Array<{ find: string | RegExp; replacement: string }>
}

/** Vite's own rule: first match wins; a string matches by prefix, a RegExp by `replace`. */
function resolveId(
  aliases: Array<{ find: string | RegExp; replacement: string }>,
  id: string,
): string {
  for (const { find, replacement } of aliases) {
    if (typeof find === 'string') {
      if (id.startsWith(find)) return replacement + id.slice(find.length)
    } else if (find.test(id)) {
      return id.replace(find, replacement)
    }
  }
  return id
}

describe('T1.2 — Vite plugin emits all subpath aliases in correct order', () => {
  it('emits at least 7 aliases', async () => {
    const aliases = await getAliasArray()
    expect(aliases.length).toBeGreaterThanOrEqual(EXPECTED_SUBPATHS.length + 1)
  })

  it('resolves every expected subpath to a real file', async () => {
    const aliases = await getAliasArray()
    for (const sub of EXPECTED_SUBPATHS) {
      const resolved = resolveId(aliases, sub)
      expect(resolved, `${sub} did not resolve`).not.toBe(sub)
      expect(existsSync(resolved), `${sub} → ${resolved} does not exist`).toBe(true)
    }
  })

  it('resolves a subpath BELOW a barrel instead of concatenating onto it (#377)', async () => {
    const aliases = await getAliasArray()
    // The whole point: this used to become `…/client/index.ts/core`.
    expect(resolveId(aliases, 'theokit/client/core')).not.toContain('index.ts/')
  })

  it('leaves a package merely named like ours alone', async () => {
    const aliases = await getAliasArray()
    // A prefix rule ate `theokit-anything` too, which no list of subpaths fixes.
    expect(resolveId(aliases, 'theokit-something/else')).toBe('theokit-something/else')
  })

  it('resolves the bare barrel to the barrel, not to a subpath rule', async () => {
    const aliases = await getAliasArray()
    const resolved = resolveId(aliases, 'theokit')
    expect(existsSync(resolved), `theokit → ${resolved} does not exist`).toBe(true)
    for (const _ of [0]) {
      expect(resolved.endsWith('index.ts') || resolved.endsWith('index.js')).toBe(true)
    }
  })
})
