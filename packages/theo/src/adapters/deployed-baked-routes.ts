/** One route as the build scanner found it, and as both emitters below read it. */
export interface BakedRoute {
  readonly filePath: string
  readonly routePath: string
  readonly methods?: readonly string[]
}

/**
 * The static imports, module map and route table a target gets INSTEAD of a directory scan.
 *
 * ## Why baked at all
 *
 * A platform that uploads a bundle and nothing else has no directory to read. `scanServerRoutes` is
 * a `readdirSync`, so on such a target it finds nothing and every route answers 404 — measured on
 * Cloudflare (#369) and again on Vercel (B-319), where `.vercel/output/functions/api.func/` holds
 * `index.mjs`, `.vc-config.json` and `assets/`, and no `src/`.
 *
 * The imports are STATIC because that is the only kind a bundler follows. A dynamic `import(path)`
 * built from a string is precisely what the platform cannot resolve, and it is what the runtime
 * loader did.
 *
 * ## Why shared rather than copied per adapter
 *
 * Two adapters need this and a third may. B-315 is what copies of one call look like after a while:
 * the same option threaded correctly by two adapters and forgotten by three, which cost a live
 * deploy per target to find. One emitter; the target only supplies what its own error message says.
 *
 * `../../` is the depth both callers write their entry at — `.theokit/cloudflare/worker.mjs` and
 * `.theokit/vercel/entry.mjs` — while `filePath` is relative to the project root.
 */
export function renderBakedRoutes(routes: readonly BakedRoute[]): {
  routeImports: string[]
  routeModuleEntries: string[]
  routeTableEntries: string[]
} {
  const routeVar = (index: number): string => `__theoRoute${String(index)}`
  return {
    routeImports: routes.map(
      (route, index) => `import * as ${routeVar(index)} from '../../${route.filePath}'`,
    ),
    routeModuleEntries: routes.map(
      (route, index) => `  ${JSON.stringify(route.filePath)}: ${routeVar(index)},`,
    ),
    routeTableEntries: routes.map(
      (route) =>
        `  { filePath: ${JSON.stringify(route.filePath)}, routePath: ${JSON.stringify(route.routePath)}, ` +
        `methods: ${JSON.stringify([...(route.methods ?? [])])}, ` +
        `...compilePattern(${JSON.stringify(route.routePath)}) },`,
    ),
  }
}

/**
 * The route-resolution runtime, as lines of the emitted entry.
 *
 * A module map, the literal table, and a loader that refuses anything the build did not bake —
 * fail-clear per `rules/error-handling.md`, because returning `undefined` here surfaces as a
 * property access far from the cause.
 *
 * `target` appears only in that refusal, so the message names the build command that fixes it. A
 * Vercel operator told to re-run `--target cloudflare` has been sent to the wrong place.
 */
export function routeRuntimeLines(
  moduleEntries: string[],
  tableEntries: string[],
  target: string,
): string[] {
  return [
    `// #369 / B-319 — the routes are baked at build time. This entry used to reach for`,
    `// \`scanServerRoutes\` on the server directory — a readdirSync, on a platform that uploads`,
    `// a bundle and no source tree. The pattern is recompiled here from the same routePath the`,
    `// scanner used, so one function decides precedence on every target.`,
    `const ROUTE_MODULES = {`,
    ...moduleEntries,
    `}`,
    ``,
    `const routes = [`,
    ...tableEntries,
    `]`,
    ``,
    `// The executor asks for a module by the path the table names. Anything else was`,
    `// never bundled, and saying so beats returning undefined and failing later on a`,
    `// property access far from the cause.`,
    `async function loadModule(path) {`,
    `  const mod = ROUTE_MODULES[path]`,
    `  if (mod === undefined) {`,
    // No backticks in this message: it is emitted INTO a template literal, and a stray one closes
    // it. That is how #344 shipped a SyntaxError, and the emitted-entry parse gate caught it.
    "  throw new Error(`Route module '" +
      '${path}' +
      "' was not bundled into this deployment. " +
      'This target uploads only what the build bundled, so every route is imported at build time. ' +
      'Re-run: theokit build --target ' +
      target +
      '`)',
    `  }`,
    `  return mod`,
    `}`,
    ``,
  ]
}
