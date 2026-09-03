/**
 * The `compilerOptions.paths` a custom import alias expands to.
 *
 * Pure by design, and separate from `cli.ts` for one measured reason: the mapping was three
 * literals inside a 90-line file that writes to disk, so the only test that could reach it was an
 * end-to-end scaffold. It went wrong exactly where an untested literal does — when the layout moved
 * under `src/`, `./server/*` and `./app/*` kept pointing at directories that no longer exist, and a
 * project generated with `--import-alias '~/*'` got a tsconfig whose aliases resolve to nothing.
 *
 * The framework's own default alias (`@/*`) is not built here: it ships in the template's tsconfig,
 * which is where a default belongs.
 */

/** Where the two domain aliases point. One place, so a future move updates one line. */
const DOMAIN_ROOTS = Object.freeze({
  server: './src/server/*',
  app: './src/app/*',
})

/**
 * Expand `prefix/*` into the tsconfig `paths` map.
 *
 * @param importAlias the alias as the user typed it, e.g. `~/*`
 */
export function aliasPaths(importAlias: string): Record<string, string[]> {
  const prefix = importAlias.replace('/*', '')
  return {
    [`${prefix}/*`]: ['./src/*'],
    [`${prefix}/server/*`]: [DOMAIN_ROOTS.server],
    [`${prefix}/app/*`]: [DOMAIN_ROOTS.app],
  }
}
