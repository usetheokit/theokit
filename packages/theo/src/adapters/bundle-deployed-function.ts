import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

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
  /**
   * The directory the platform will upload, absolute.
   *
   * It reaches vite with `emptyOutDir: true`, so whatever is there is DELETED. Emptying a build
   * output directory is the point, and it is why this must be a directory the caller owns — it is not
   * required to sit inside `projectRoot` (the test for this function passes a sibling, deliberately),
   * so nothing here can check it for you.
   */
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
/**
 * Thrown at BUILD time when a path this function would write to leaves the project.
 *
 * Named like `UnserialisableRateLimitError` next door, because the adapters report a build-time
 * refusal as a typed domain error rather than a string (`rules/error-handling.md`).
 *
 * The invariant was DECLARED and unenforced. `stagePath`'s own docblock says "inside the root is not a
 * preference", and nothing checked it — `resolve(root, '../outside/entry.mjs')` wrote the entry outside
 * the project, and `resolve(root, '/etc/theo-entry.mjs')` discarded the root entirely and was stopped
 * only by filesystem permissions (`EACCES`, measured 2026-09-28).
 *
 * It covers `stagePath` and NOT `outDir`, which is a correction rather than an omission. A first
 * version checked both, and the pre-existing test for this function passes an `outDir` that is a
 * SIBLING of `projectRoot` — which the option's contract permits, since it is documented as "the
 * directory the platform will upload, absolute" and nothing more. The invariant was invented, the test
 * refused it, and the test was right.
 */
export class PathOutsideProjectRootError extends Error {
  override readonly name = 'PathOutsideProjectRootError'

  constructor(field: string, value: string, resolved: string, projectRoot: string) {
    super(
      `bundleDeployedFunction: \`${field}\` must stay inside \`projectRoot\`. ` +
        `Given ${JSON.stringify(value)}, which resolves to ${JSON.stringify(resolved)}, ` +
        `outside ${JSON.stringify(projectRoot)}.`,
    )
  }
}

export async function bundleDeployedFunction(
  options: BundleDeployedFunctionOptions,
): Promise<void> {
  // Validated at the boundary, before anything is written — `rules/error-handling.md`: reject invalid
  // input before processing, and this function's first act is a write.
  const rootAbs = resolve(options.projectRoot)
  const isInside = (candidate: string): boolean =>
    candidate === rootAbs || candidate.startsWith(`${rootAbs}${sep}`)

  const stageAbs = resolve(rootAbs, options.stagePath)
  if (!isInside(stageAbs)) {
    throw new PathOutsideProjectRootError('stagePath', options.stagePath, stageAbs, rootAbs)
  }
  // `stageAbs` is proven above to resolve inside `projectRoot`, and it is a build-time path rather
  // than request input. The exemption is per-call rather than per-file on purpose: a file-scope
  // disable would silently cover an fs call somebody adds later, whose path nothing proved.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- proven inside projectRoot above
  mkdirSync(dirname(stageAbs), { recursive: true })
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- proven inside projectRoot above
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
