/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time only. Every path derives from the caller's `projectRoot` and a fixed layout under
 * `.theokit/`; nothing here reads HTTP input.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { build as viteBuild } from 'vite'

/** What the caller has to say to get a self-contained function out. */
export interface BundleDeployedFunctionOptions {
  /** The project being built. Everything else is resolved against it. */
  projectRoot: string
  /** The generated entry source, as the adapter rendered it. */
  entrySource: string
  /**
   * Where the staged entry is written, relative to `projectRoot`.
   *
   * Inside the root is not a preference. Measured while establishing ADR 0020: an entry staged in
   * `/tmp` makes rollup resolve `theokit/server/scan` from `/tmp` and the build fails with an
   * unresolved import, because a specifier resolves relative to the importing FILE.
   */
  stagePath: string
  /** The directory the platform will upload, absolute. */
  outDir: string
  /** The file name the platform expects inside `outDir`. */
  entryFileName: string
}

/**
 * Bundle a generated entry into a directory that loads with no `node_modules` beside it.
 *
 * ## Why this exists at all
 *
 * A platform either resolves the entry's bare specifiers or it does not, and three answers are in
 * play. `wrangler` bundles with esbuild at deploy time; Bun resolves against the project's own
 * `node_modules` at run time; **Vercel's Build Output API v3 uploads a `.func` directory as it is**,
 * and AWS Lambda does the same with a zip. Measured 2026-09-26 on this repository's own scaffold:
 *
 *     cp -a .vercel/output/functions/api.func/. /tmp/fn/ && cd /tmp/fn
 *     node -e "import('./index.mjs')"
 *     -> ERR_MODULE_NOT_FOUND: Cannot find package 'theokit'
 *
 * So the adapter bundles when the platform will not. The decision, the rejected alternatives and the
 * measurements are ADR 0020; this is its one implementation, shared rather than copied per target
 * because B-315 is what five copies of one call look like after a while.
 *
 * ## Why vite
 *
 * The parsimony ladder's fourth rung. `esbuild` resolves from neither the repository root nor
 * `packages/theo` — it is an undeclared transitive dependency — while `vite` is declared and
 * `adapters/node.ts` already runs `viteBuild` for the same shape of job. Reuse over addition.
 *
 * ## What it does NOT do
 *
 * It does not verify the bundle answers a request. That needs the platform. What it establishes is
 * the property that was false: the directory loads on its own.
 */
export async function bundleDeployedFunction(
  options: BundleDeployedFunctionOptions,
): Promise<void> {
  const stageAbs = resolve(options.projectRoot, options.stagePath)
  mkdirSync(dirname(stageAbs), { recursive: true })
  writeFileSync(stageAbs, options.entrySource, 'utf8')

  await viteBuild({
    root: options.projectRoot,
    // The project's own vite config is for its APP. Reading it here would apply its plugins, its
    // aliases and its `build.outDir` to a server entry that wants none of them.
    configFile: false,
    logLevel: 'warn',
    // The whole point: without this, vite externalises every bare specifier and the output has the
    // same unresolvable imports the input had.
    ssr: { noExternal: true },
    build: {
      ssr: true,
      outDir: options.outDir,
      emptyOutDir: true,
      // Measured: with `root` at the project, vite otherwise copies `index.html`, `logo.png`,
      // `favicon.svg` and `robots.txt` into the function directory — a lambda carrying the site's
      // static assets, and an `index.html` sitting beside a handler.
      copyPublicDir: false,
      rollupOptions: {
        input: stageAbs,
        output: { entryFileNames: options.entryFileName, format: 'esm' },
      },
    },
  })
}
