/**
 * Emits `assets-map.json` — the route-to-chunks relation a document needs in order to preload
 * what the current route will import, instead of discovering it one round trip later.
 *
 * Chunk names exist only AFTER bundling, which is why this is a `generateBundle` hook and not a
 * post-build script reading `.vite/manifest.json`: Rollup hands the bundle in as an argument, and
 * the pre-bundle manifests must keep emitting before Vite so a failing build still leaves
 * diagnostics (B-035 ADR-1).
 *
 * `apply: 'build'` is not decoration. The plugin set this joins is shared by `theokit build`,
 * `theo dev` and `theo agent`; removing the plugin from the two serve chains is stronger than
 * relying on the hook never being reached there. The repository already uses the mirror of this in
 * `services-typed-client.ts` (`apply: 'serve'`, "dev-only; never runs in build").
 *
 * The SSR pass is skipped by reading the RESOLVED `build.ssr`, never a factory option: the adapter
 * calls the plugin factory twice (`adapters/node.ts:57` client, `:71` ssr) and passes `ssr: true`
 * to BOTH when the project enables SSR, so the option in the signature cannot tell the passes
 * apart. Emitting on the server pass would produce a second, unread `assets-map.json` under
 * `.theokit/server/` — harmless, because `this.emitFile` can only write inside its own build's
 * `outDir`, and deliberately avoided anyway so no future reader picks the wrong one.
 */
import type { Plugin } from 'vite'

/** A route path mapped to the chunk file names it needs beyond what the entry already loads. */
export type AssetsMap = Record<string, string[]>

/** Rollup's `generateBundle` bundle value, narrowed to the fields this hook reads. */
interface BundleChunk {
  type: string
  isEntry?: boolean
  fileName: string
  facadeModuleId?: string | null
  imports?: string[]
}

/**
 * A bundle as this hook reads it. The value is `| undefined` ON PURPOSE: an `imports` entry may
 * name something the bundle does not contain (an external), and a lookup that cannot miss would
 * make the optional chain in `staticClosure` look redundant to a type-based lint while removing
 * it would crash at runtime. The type is widened to match reality rather than the guard narrowed
 * to match the type.
 */
type BundleLike = Record<string, BundleChunk | undefined>

const PAGE_FILE = /[/\\]page\.(tsx|ts|jsx|js)$/

/**
 * Derive the route path a page file serves. `<appDir>/about/page.tsx` -> `/about`;
 * `<appDir>/page.tsx` -> `/`. Returns undefined when the file is not a page under `appDir`.
 */
export function routePathForPageFile(appDir: string, moduleId: string): string | undefined {
  const normalised = moduleId.replace(/\\/g, '/')
  const root = appDir.replace(/\\/g, '/').replace(/\/$/, '')
  if (!normalised.startsWith(`${root}/`)) return undefined
  if (!PAGE_FILE.test(normalised)) return undefined
  const relative = normalised.slice(root.length).replace(PAGE_FILE, '')
  return relative === '' ? '/' : relative
}

/**
 * Every chunk reachable from `start` through STATIC imports, `start` included. Dynamic imports are
 * deliberately excluded: they are what the browser fetches later, by definition, and preloading
 * them would defeat the split that produced them.
 */
function staticClosure(bundle: BundleLike, start: string): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const name = queue.pop()
    if (name === undefined || seen.has(name)) continue
    seen.add(name)
    for (const next of bundle[name]?.imports ?? []) queue.push(next)
  }
  return seen
}

/**
 * Compute the map from a Rollup bundle. Exported for unit testing without running a build —
 * the hook below is a thin wrapper so this function carries the behaviour.
 */
export function buildAssetsMap(bundle: BundleLike, appDir: string): AssetsMap {
  const chunks = Object.entries(bundle).filter(
    (entry): entry is [string, BundleChunk] => entry[1]?.type === 'chunk',
  )

  // What the document already loads. A route needing only these needs no preload at all, which is
  // the case an over-eager implementation gets wrong and the empty array records honestly.
  const alreadyLoaded = new Set<string>()
  for (const [name, chunk] of chunks) {
    if (chunk.isEntry === true) {
      for (const reachable of staticClosure(bundle, name)) alreadyLoaded.add(reachable)
    }
  }

  const map: AssetsMap = {}
  for (const [name, chunk] of chunks) {
    const moduleId = chunk.facadeModuleId
    if (moduleId === undefined || moduleId === null) continue
    const route = routePathForPageFile(appDir, moduleId)
    if (route === undefined) continue
    map[route] = [...staticClosure(bundle, name)]
      .filter((f) => !alreadyLoaded.has(f))
      .sort((a, b) => a.localeCompare(b))
  }
  return map
}

/** The plugin. See the module docblock for why `apply` and the SSR skip are what they are. */
export function assetsMapPlugin(opts: { appDir: string }): Plugin {
  let isSsrPass = false
  return {
    name: 'theokit:assets-map',
    apply: 'build',
    configResolved(config) {
      // The RESOLVED flag, per build pass — not the factory option, which is `true` in both.
      isSsrPass = Boolean(config.build.ssr)
    },
    generateBundle(_options, bundle) {
      if (isSsrPass) return
      const map = buildAssetsMap(bundle, opts.appDir)
      this.emitFile({
        type: 'asset',
        fileName: 'assets-map.json',
        source: `${JSON.stringify(map, null, 2)}\n`,
      })
    },
  }
}
