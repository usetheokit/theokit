/**
 * Helper for loading user-authored TypeScript modules at runtime.
 *
 * Why this exists: theokit framework code (`load-config.ts`, `job-scan.ts`,
 * `cron-scan.ts`, `integrate-ui.ts`, `static.ts`) dynamically imports
 * `.ts` files from user space (`theo.config.ts`, `server/jobs/*.ts`,
 * `static-paths.ts`, etc.). Two execution environments must work:
 *
 *   1. **Production CLI** — `dist/cli/index.js` starts with
 *      `import "tsx/esm"` which registers a global Node ESM loader hook.
 *      Subsequent `await import('foo.ts')` calls are intercepted by the
 *      hook, transformed in-place, and returned as ESM namespaces.
 *
 *   2. **Vitest tests** — Vitest runs framework code through Vite's SSR
 *      pipeline. Dynamic imports inside framework modules are hijacked
 *      by Vite's `loadAndTransform`, which cannot resolve absolute paths
 *      outside the Vite project root (e.g., `/tmp/test-fixture/foo.ts`).
 *      Even with `server.deps.external` configured to hand the path
 *      back to Node, the registered tsx/esm loader hits a `require()`
 *      ESM cycle error on Node 22 because the calling stack contains
 *      both the loader's own evaluation context AND the importer.
 *
 * `tsImport()` from `tsx/esm/api` is the documented escape hatch for
 * exactly this scenario: it transforms the source file via tsx's
 * standalone pipeline and evaluates the result via a fresh namespace,
 * bypassing both Vite SSR and any registered global hook.
 *
 * Strategy:
 *   - Try native `await import()` first (zero overhead in production
 *     where tsx hook is registered).
 *   - On failure with the well-known cycle/resolution errors, fall back
 *     to `tsImport()`. Other errors (genuine syntax errors, missing
 *     module, etc.) propagate unchanged.
 *
 * Idempotent and side-effect-free.
 */
import { pathToFileURL } from 'node:url'

const CYCLE_PATTERNS = [
  // Node 22 strict ESM cycle detection when a registered loader hook
  // re-enters its own evaluation context.
  'require() ES Module',
  'in a cycle',
  // Vite SSR throws this when it cannot resolve an out-of-root URL.
  'Failed to load url',
  'Does the file exist?',
  // Node native ESM resolver throws this for `.ts` files when no
  // tsx loader is registered globally (the common test-worker case).
  'Cannot find module',
  // ERR_UNKNOWN_FILE_EXTENSION for `.ts` files.
  'Unknown file extension',
]

function isLoaderInteropError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  return CYCLE_PATTERNS.some((p) => msg.includes(p))
}

/**
 * Load a user-authored TS/JS module at the given absolute file path.
 * `parentURL` defaults to the URL of this module file.
 *
 * @returns module namespace object (matches `await import(...)` return)
 */
export async function importUserModule(
  absoluteFilePath: string,
  parentURL: string = import.meta.url,
): Promise<Record<string, unknown>> {
  const fileURL = pathToFileURL(absoluteFilePath).href
  try {
    return (await import(fileURL)) as Record<string, unknown>
  } catch (err) {
    if (!isLoaderInteropError(err)) throw err
    // Fallback: tsx programmatic API. Imports are inline, no global hook
    // mutation, no Vite SSR interference. Slower per call (~10-50ms vs
    // microseconds for registered loader) but only used as a last resort.
    const { tsImport } = (await import('tsx/esm/api')) as {
      tsImport: (
        specifier: string,
        options: string | { parentURL: string; tsconfig?: string; namespace?: string },
      ) => Promise<Record<string, unknown>>
    }
    // Bypass tsconfig — tsx's default bundler-style resolver handles
    // `.js → .ts` fallback for relative imports under the user's module.
    // Passing an explicit tsconfig sometimes shadows the default and
    // breaks the `.js → .ts` rewrite chain inside the namespaced loader
    // (verified empirically in cron-scan/job-scan vitest workers).
    return await tsImport(fileURL, parentURL)
  }
}
