/**
 * The configuration a deployed entry cannot carry as a literal (usetheokit/theokit#425).
 *
 * ## Why this is not another literal renderer
 *
 * `deployed-csrf.ts` and `deployed-cors.ts` bake their values into the emitted source, which works
 * because `csrf` is an enum and `disallowed` is a `{ routes, behavior }` object — plain data, and a
 * deployed function has no `theo.config.ts` to read.
 *
 * `plugins` and `serialization.transformer` carry FUNCTIONS. There is no literal for a closure. So
 * the entry has to reach the app's own module instead, and the only question left is WHEN.
 *
 * ## Static import, not `import()` in the request path
 *
 * The tempting shortcut is `await import('../../theo.config.js')` inside the handler. It trades a
 * silent failure for a louder one on targets with no filesystem, and it moves configuration
 * resolution into every request on the targets that do have one.
 *
 * What this emits instead is a TOP-LEVEL import of a module the build already resolved and wrote
 * beside the entry — the same shape `renderBakedRoutes` uses for route modules (#369): decide on
 * the build machine, emit a static specifier. It is evaluated once at module load, the target's
 * bundler can see through it, and a plugin that needs an API the target lacks fails the build
 * rather than the first request.
 *
 * ## Why the module is optional
 *
 * An app that declares neither concern must produce the entry it produced before this existed.
 * Importing a module the build did not emit fails at load, and spreading an empty object costs an
 * allocation per request for nothing. So `undefined` renders to nothing at all, and the caller's
 * `executeRoute` literal is unchanged.
 */

/**
 * The option every Web-standards adapter grows to carry non-serialisable configuration.
 *
 * Composed into each adapter's option type the way `DeployedCsrfOptions` already is, so the six
 * targets cannot drift into six spellings of the same field.
 */
export interface DeployedRuntimeConfigOptions {
  /**
   * Specifier of the runtime-config module the build wrote beside the entry, or `undefined` when
   * the app declared neither `plugins` nor `serialization` and the build wrote none.
   */
  runtimeConfigModule?: string
}

/** The three places an entry has to grow to carry non-serialisable configuration. */
export interface DeployedRuntimeConfigFragment {
  /** Top-level imports. Empty when the build emitted no config module. */
  readonly imports: string[]
  /** Module-scope declarations — evaluated once, at load. Empty when there is nothing to carry. */
  readonly declarations: string[]
  /**
   * Spread into the entry's `executeRoute({ … })` literal, inside an async function.
   *
   * Empty string when there is nothing to carry, so the call site keeps the exact shape it had.
   */
  readonly executeRouteSpread: string
}

const EMPTY: DeployedRuntimeConfigFragment = {
  imports: [],
  declarations: [],
  executeRouteSpread: '',
}

/**
 * What a deployed entry needs in order to apply `config.plugins` and `config.serialization`.
 *
 * @param moduleSpecifier - specifier of the runtime-config module the build emitted beside the
 *   entry, or `undefined` when the app declared neither concern and the build emitted none.
 */
export function deployedRuntimeConfigFragment(
  moduleSpecifier: string | undefined,
): DeployedRuntimeConfigFragment {
  if (moduleSpecifier === undefined) return EMPTY

  return {
    imports: [
      `import { createPluginRunnerFromConfig } from 'theokit/server'`,
      `// #425 — the app's own config, resolved on the build machine and written beside this entry.`,
      `// A closure has no literal, so this is an import rather than a baked value.`,
      `import theoRuntimeConfig from '${moduleSpecifier}'`,
    ],
    declarations: [
      `// Built ONCE, at module load. A runner rebuilt per request would re-run every plugin's`,
      `// \`register\`, which is where a plugin allocates the state its hooks then read.`,
      `const THEO_PLUGIN_RUNNER = createPluginRunnerFromConfig(theoRuntimeConfig.plugins)`,
      `// T1.2 — a named transformer is also what makes \`executeRoute\` emit \`x-theo-transformer\`,`,
      `// so a client is told which serialisation it is reading rather than left to guess.`,
      `const THEO_TRANSFORMER = theoRuntimeConfig.serialization?.transformer`,
    ],
    // Awaited, not passed along: `createPluginRunnerFromConfig` is async because `register` is, and
    // a pending promise handed to `executeRoute` is a truthy object with none of the runner's
    // methods — every hook would silently not fire, which is this issue's own defect one layer in.
    executeRouteSpread: `pluginRunner: await THEO_PLUGIN_RUNNER, transformer: THEO_TRANSFORMER,`,
  }
}
