import type { ViteDevServer } from 'vite'

import { importUserModule } from '../../config/import-user-module.js'

export type LoadModule = (path: string) => Promise<Record<string, unknown>>

export function createViteLoader(vite: ViteDevServer): LoadModule {
  return (path) => vite.ssrLoadModule(path) as Promise<Record<string, unknown>>
}

/**
 * The loader `theokit start` uses to read user-authored modules off disk.
 *
 * It delegates to {@link importUserModule} rather than calling `import()` itself
 * (usetheokit/theokit#418). The raw call worked only because the CLI bin starts with
 * `import "tsx/esm"`, registering a global ESM hook — so this function depended on a side effect it
 * never performed, from a module it does not reference. Any caller that reached it another way (a
 * test booting the real handler, an app embedding the framework) got
 * `ERR_UNKNOWN_FILE_EXTENSION` for a `.ts` file, or `__filename is not defined in ES module scope`
 * from tsx's CJS output.
 *
 * That was invisible above Node 22.18, where native type stripping loads the file regardless, which
 * is how it survived on a project declaring `engines.node: ">=22.12.0"`.
 *
 * Production is unchanged in cost: `importUserModule` tries the native import FIRST, so with the
 * hook registered it takes exactly the path this used to take, and the fallback only runs where the
 * raw call would have thrown.
 */
export function createProductionLoader(): LoadModule {
  return (path) => importUserModule(path)
}
