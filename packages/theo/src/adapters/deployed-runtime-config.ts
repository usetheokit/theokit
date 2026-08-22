/**
 * The configuration a deployed entry could not apply (usetheokit/theokit#425).
 *
 * ## Why this is not another literal renderer
 *
 * `deployed-csrf.ts` and `deployed-cors.ts` bake their values into the emitted source, which works
 * because `csrf` is an enum and `disallowed` is a `{ routes, behavior }` object — plain data, and a
 * deployed function has no `theo.config.ts` to read.
 *
 * The two concerns left over from #410 turn out to be different from each other, and the difference
 * is the whole design:
 *
 * - **`serialization` is plain data too.** The config field is `z.enum(['json', 'superjson'])`
 *   (`config/schema.ts:147`) — a selector, not a transformer. `resolveTransformer` turns it into the
 *   functions, and it already ships from `theokit/server`. So this half is a literal like the rest,
 *   and the deployed entry resolves it exactly the way `theokit start` does
 *   (`cli/commands/start/index.ts:108`), from the same string, through the same function.
 * - **`plugins` genuinely carries functions.** A plugin is constructed in `theo.config.ts` and there
 *   is no literal for a closure, so this half needs the entry to import a module instead.
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
 * ## Why each half is optional
 *
 * An app that declares neither concern must produce the entry it produced before this existed.
 * Importing a module the build did not emit fails at load, and spreading an empty object costs an
 * allocation per request for nothing. So an empty request renders to nothing at all, and the
 * caller's `executeRoute` literal is unchanged.
 *
 * The halves are independent on purpose: an app that only picks `superjson` must not be made to
 * carry a plugins module, and an app with plugins and default JSON must not gain a transformer
 * lookup. Coupling them would have made the common case pay for the rare one.
 */

/**
 * The option every Web-standards adapter grows to carry non-serialisable configuration.
 *
 * Composed into each adapter's option type the way `DeployedCsrfOptions` already is, so the six
 * targets cannot drift into six spellings of the same field.
 */
export interface DeployedRuntimeConfigOptions {
  /**
   * Specifier of the plugins module the build wrote beside the entry, or `undefined` when the app
   * declares no plugins and the build wrote none.
   */
  runtimeConfigModule?: string
  /**
   * The app's `serialization` selector, carried as a literal.
   *
   * `'json'` and `undefined` both mean the default, and neither emits anything: `executeRoute`
   * already falls back to `JSON.stringify`, and the `x-theo-transformer` header is deliberately
   * absent for the default so a client is told only when there is something to be told.
   */
  serialization?: 'json' | 'superjson'
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
  options: DeployedRuntimeConfigOptions | undefined,
): DeployedRuntimeConfigFragment {
  const pluginsModule = options?.runtimeConfigModule
  // 'json' is the default and emits nothing — see `serialization` above.
  const serialization = options?.serialization === 'superjson' ? 'superjson' : undefined
  if (pluginsModule === undefined && serialization === undefined) return EMPTY

  const imports: string[] = []
  const declarations: string[] = []
  const spread: string[] = []

  if (pluginsModule !== undefined) {
    imports.push(
      `import { createPluginRunnerFromConfig } from 'theokit/server'`,
      `// #425 — the app's own plugins, resolved on the build machine and written beside this entry.`,
      `// A closure has no literal, so this is an import rather than a baked value.`,
      `import theoRuntimeConfig from '${pluginsModule}'`,
    )
    declarations.push(
      `// Built ONCE, at module load. A runner rebuilt per request would re-run every plugin's`,
      `// \`register\`, which is where a plugin allocates the state its hooks then read.`,
      `const THEO_PLUGIN_RUNNER = createPluginRunnerFromConfig(theoRuntimeConfig.plugins)`,
    )
    // Awaited, not passed along: `createPluginRunnerFromConfig` is async because `register` is, and
    // a pending promise handed to `executeRoute` is a truthy object with none of the runner's
    // methods — every hook would silently not fire, which is this issue's own defect one layer in.
    spread.push(`pluginRunner: await THEO_PLUGIN_RUNNER`)
  }

  if (serialization !== undefined) {
    imports.push(`import { resolveTransformer } from 'theokit/server'`)
    declarations.push(
      `// #425 — a literal, because \`config.serialization\` is a SELECTOR and not a transformer.`,
      `// Same string, same function \`theokit start\` calls, so the deployed response and the local`,
      `// one cannot disagree about what the app asked for — including the \`x-theo-transformer\``,
      `// header, whose absence is what made this a data bug rather than a formatting one.`,
      `const THEO_TRANSFORMER = resolveTransformer('${serialization}')`,
    )
    spread.push(`transformer: THEO_TRANSFORMER`)
  }

  return { imports, declarations, executeRouteSpread: `${spread.join(', ')},` }
}
