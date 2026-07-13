/**
 * #122 (T2.1) — typed-client codegen for decorator controllers.
 *
 * Collects the routing metadata of every `@Controller` under `controllersDir`
 * so the app-typed-client codegen can emit `client.<ns>.<method>()` entries.
 * Codegen loads controllers via `loadControllerWithSwc` (swc-compile + import,
 * no Vite dev server needed) — distinct from the dev SERVING path, which loads
 * through Vite's `ssrLoadModule`.
 *
 * ADR-2 checkpoint (LOCKED — see the plan's Unresolved Questions): only the
 * RESPONSE type is inferred, via `Awaited<ReturnType<InstanceType<typeof C>['m']>>`.
 * Request `@Body` types are NOT inferred from the class — parameter decorators are
 * erased runtime metadata, invisible to the type system, so `Parameters<...>[N]` is
 * positional-only and cannot tell body from param from query. Body falls back to
 * `unknown` (runtime `@Body` Zod validation from Phase 1 still applies). Full body
 * inference is tracked in the follow-up issue.
 */
import { loadControllerWithSwc, walkControllerMetadata } from '@theokit/http'

import {
  scanControllerModules,
  type ControllerModuleLoader,
} from '../server/http/controller-dispatch.js'

/** One controller route, flattened for the client codegen. */
export interface ControllerRouteData {
  /** Absolute path to the `*.controller.ts` source (for the `import type` line). */
  filePath: string
  /** The exported class name (e.g. `TasksController`). */
  className: string
  /** Full route path, e.g. `/api/v2/tasks/:id`. */
  fullPath: string
  /** HTTP verb (`GET`, `POST`, …). */
  verb: string
  /** The controller method name backing this route (e.g. `findById`). */
  methodName: string
}

/**
 * Scan `controllersDir` and flatten every controller's routes into
 * {@link ControllerRouteData}. Returns `[]` when the directory has no controllers
 * (so the codegen contributes zero bytes — ADR-5 routes-only byte-identity).
 */
export async function collectControllerRouteData(opts: {
  controllersDir: string
  loadModule?: ControllerModuleLoader
}): Promise<ControllerRouteData[]> {
  const loader = opts.loadModule ?? loadControllerWithSwc
  const modules = await scanControllerModules(opts.controllersDir, loader)
  const out: ControllerRouteData[] = []
  for (const { filePath, cls } of modules) {
    const className = (cls as { name: string }).name
    for (const walk of walkControllerMetadata(cls)) {
      out.push({
        filePath,
        className,
        fullPath: walk.fullPath,
        verb: walk.verb,
        methodName: String(walk.propertyKey),
      })
    }
  }
  return out
}
