/**
 * The deprecation on `theokit/server` promises a destination
 * (usetheokit/theokit#372).
 *
 * Importing the umbrella prints "Use sub-paths (theokit/server/<domain>)" and
 * schedules removal for `0.x+2`. That instruction is only followable if every
 * symbol the umbrella exports is reachable from some subpath. Measured against
 * the build on 2026-08-20, 58 of 272 were not — including the whole cache
 * surface, so `revalidateTag` and `revalidatePath` existed only behind an import
 * the framework itself tells you to stop using.
 *
 * This asserts the invariant rather than a list of names. A list would have to
 * be updated by the same person who broke it; the invariant is what noticed 58.
 *
 * It reads the BUILT package on purpose. The question is what a consumer can
 * import, and `exports` maps to `dist/` — a source-level check would answer a
 * question nobody asks.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect, beforeAll } from 'vitest'

import {
  BUILD_HOOK_TIMEOUT_MS,
  buildTheokitPackageOnce,
} from '../integration/_helpers/build-theokit-package.js'

const packageRoot = resolve(__dirname, '../../packages/theo')

/**
 * Families with no subpath at all, as measured on 2026-08-20. Each entry is a
 * public-surface decision nobody has made yet — which domain owns it — and not a
 * missing re-export, so they are named here rather than silently tolerated.
 *
 * This list may only ever shrink. Adding to it means shipping a symbol the
 * deprecation message cannot route, which is the defect, not a workaround for it.
 */
const NO_SUBPATH_YET = new Set([
  // cache — needs a `./server/cache` subpath (usetheokit/theokit#372)
  'revalidateTag',
  'revalidatePath',
  'updateTag',
  'defineCachedRoute',
  'defineCachedFunction',
  'initCacheEngine',
  'getCacheEngine',
  'createCacheEngine',
  'InMemoryCacheAdapter',
  'deriveCacheKey',
  'getCacheControlHeader',
  'serializeResponse',
  'deserializeResponse',
  'compileRouteRules',
  'resolveRouteRule',
  'validateCacheTags',
  'validateCacheMaxAge',
  'validateCacheExpire',
  '_resetCacheEngine',
  'DEFAULT_EXCLUDED_QUERY_PARAMS',
  'CACHE_DEFAULT_MAX_AGE',
  'CACHE_DEFAULT_MAX_ENTRY_SIZE',
  'CACHE_DEFAULT_SWR_MULTIPLIER',
  'CACHE_TAG_MAX_ITEMS',
  'CACHE_TAG_MAX_LENGTH',
  // config / env
  'LayeredConfig',
  'LayerOutOfOrderError',
  'loadEnv',
  '_resetEnvCache',
  'CTX_WRITERS',
  'THEO_T_PREFIX',
  // instructions and custom commands
  'composeInstructions',
  'loadInstructionTree',
  'loadCustomCommands',
  'splitFrontmatter',
  'frontmatterValue',
  // context pressure
  'contextPressure',
  'ContextPressureThresholdError',
  'DEFAULT_CONTEXT_PRESSURE_THRESHOLDS',
  'effectiveContextWindow',
  // trust store
  'TrustStore',
  'TrustStorePermissionsError',
])

type ExportsMap = Record<
  string,
  string | { import?: string | { default?: string }; default?: string }
>

function entryFileOf(target: ExportsMap[string]): string | undefined {
  if (typeof target === 'string') return target
  const imported = target.import
  if (typeof imported === 'string') return imported
  if (imported?.default !== undefined) return imported.default
  return target.default
}

describe('every umbrella symbol has a subpath to migrate to (#372)', () => {
  let umbrellaNames: string[] = []
  let reachable = new Set<string>()

  beforeAll(async () => {
    buildTheokitPackageOnce()
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      exports: ExportsMap
    }
    const umbrella: Record<string, unknown> = await import(
      resolve(packageRoot, 'dist/server/index.js')
    )
    umbrellaNames = Object.keys(umbrella).filter((n) => n !== 'default')

    reachable = new Set<string>()
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (!subpath.startsWith('./server') || subpath === './server') continue
      const file = entryFileOf(target)
      if (file === undefined) continue
      const absolute = resolve(packageRoot, file)
      if (!existsSync(absolute)) continue
      const mod: Record<string, unknown> = await import(absolute)
      for (const name of Object.keys(mod)) reachable.add(name)
    }
  }, BUILD_HOOK_TIMEOUT_MS)

  it('test_the_scan_actually_loaded_something', () => {
    // Guards the guard: a broken exports read would make every assertion below
    // pass by finding nothing to check.
    expect(umbrellaNames.length).toBeGreaterThan(100)
    expect(reachable.size).toBeGreaterThan(100)
  })

  it('test_no_umbrella_symbol_is_orphaned_outside_the_declared_families', () => {
    const orphans = umbrellaNames.filter((n) => !reachable.has(n) && !NO_SUBPATH_YET.has(n))

    expect(orphans, `orphaned with no subpath and not declared: ${orphans.join(', ')}`).toEqual([])
  })

  it('test_the_declared_list_does_not_outlive_the_problem', () => {
    // A name that gained a subpath must leave the list, or the list stops
    // describing anything and starts hiding the next regression.
    const stale = [...NO_SUBPATH_YET].filter((n) => reachable.has(n))

    expect(stale, `declared as having no subpath, but reachable now: ${stale.join(', ')}`).toEqual(
      [],
    )
  })
})
