/**
 * Turn `config.plugins` entries that are module SPECIFIERS into plugins (usetheokit/theokit#425).
 *
 * ## Why the field grew a second shape
 *
 * `config.plugins` holds constructed objects, and a generated deploy entry cannot carry a closure:
 * there is no literal for one. So on all six Web-standards targets the entry built its request
 * context with no runner and every lifecycle hook was dead on a deployed app while firing locally.
 *
 * Two ways out were weighed:
 *
 * - **Bundle `theo.config.ts` into the entry.** Rejected on measurement. It silently drops
 *   `theo.config.<NODE_ENV>.ts`, which `loadConfig` merges (`config/load-config.ts:92`) — a new
 *   silent drop, which is the exact class of defect this work exists to remove. And it pulls every
 *   module the config imports (database drivers, build-only helpers) into a Worker bundle that
 *   builds today, so the common case would pay for the rare one.
 * - **Name the module.** A string entry says which module the plugin comes from, so the build emits
 *   a static import for that module and nothing else. One declaration serves the local server and
 *   the deployed entry, which is what keeps them from disagreeing.
 *
 * The second is what this implements. It is ADDITIVE: an app passing constructed objects is
 * untouched, and gets the same treatment it always got.
 *
 * ## Why this lives in `config/` and not beside `createPluginRunnerFromConfig`
 *
 * Resolving a specifier means importing a path, and that means `node:url`/`node:path`. `server/`
 * holds a no-`node:*` invariant so the same code serves the Web, Tauri and TUI targets
 * (`rules/three-target-parity.md`). `config/` already reads the filesystem — `load-config.ts` is
 * the module that finds `theo.config.ts` at all — and it is the one place BOTH local entry points
 * (`theokit start` and the Vite dev server) already import from. So the specifier is resolved
 * where the config is read, and `createPluginRunnerFromConfig` keeps taking what it always took:
 * objects.
 */
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * A declared plugin module that could not be turned into a plugin.
 *
 * Its own error type because the alternative — skipping the entry — leaves an app running with one
 * fewer plugin than it declared and nothing saying so. That is the failure this issue is about,
 * reproduced at the door.
 */
export class UnresolvablePluginSpecifierError extends Error {
  constructor(index: number, specifier: string, reason: string) {
    super(`plugins[${index}] (${specifier}) could not be loaded: ${reason}`)
    this.name = 'UnresolvablePluginSpecifierError'
  }
}

/**
 * Resolve every string entry in `plugins` to the module's default export, in order.
 *
 * @param plugins - the raw `config.plugins` array: constructed plugins, module specifiers, or both.
 * @param cwd - the project root a relative specifier is resolved against.
 */
export async function resolvePluginSpecifiers(
  plugins: readonly unknown[],
  cwd: string,
): Promise<unknown[]> {
  const resolved: unknown[] = []
  // Sequential on purpose. Plugin order is hook order, and resolving concurrently then collecting
  // as each settles would reorder an app's lifecycle by module size.
  for (const [index, entry] of plugins.entries()) {
    resolved.push(typeof entry === 'string' ? await importPlugin(entry, index, cwd) : entry)
  }
  return resolved
}

async function importPlugin(specifier: string, index: number, cwd: string): Promise<unknown> {
  const target = isAbsolute(specifier) ? specifier : resolve(cwd, specifier)
  let mod: { default?: unknown }
  try {
    mod = (await import(/* @vite-ignore */ pathToFileURL(target).href)) as { default?: unknown }
  } catch (err) {
    throw new UnresolvablePluginSpecifierError(index, specifier, messageOf(err))
  }
  if (mod.default === undefined) {
    // Registering `undefined` would fail later inside `createPluginRunnerFromConfig` with an error
    // naming a shape rather than a file, which is the harder half of the diagnosis.
    throw new UnresolvablePluginSpecifierError(
      index,
      specifier,
      'the module has no default export; a plugin module must `export default` its plugin',
    )
  }
  return mod.default
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
