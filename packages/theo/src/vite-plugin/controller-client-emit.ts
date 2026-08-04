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
  /**
   * theokit#124 — the EXPORTED name of the `@Body(schema)` Zod schema, when it has one.
   *
   * Absent when the schema is declared inline or otherwise not exported: there is then no
   * identifier the emitted `.d.ts` could reference, and the body stays `unknown`.
   */
  bodySchemaExport?: string
  /** theokit#124 — same for `@Query(schema)`. */
  querySchemaExport?: string
  /**
   * theokit#124 — a `@Body`/`@Query` schema EXISTS on this route but is not exported, so no name
   * could be referenced and the type degraded to `unknown`.
   *
   * Distinct from "there is no schema at all": that route was never going to be typed and needs no
   * explanation, while this one looks arbitrarily untyped next to a typed neighbour. The codegen
   * turns this into a note in the emitted file so the difference is legible.
   */
  schemaNotExported?: boolean
}

/**
 * Recover the EXPORTED name of a runtime schema object — theokit#124.
 *
 * `WalkResult.bodySchema` is a `z.ZodType` instance with no source identifier, which is why #122's
 * ADR-2 checkpoint concluded the request type was unrecoverable. It is recoverable, just not from
 * the metadata: the codegen already imports the module, so this object IS the one the module
 * exported, and reference identity gives back its name. No parsing, no heuristics — either some
 * export is the same object or none is.
 *
 * Returns `undefined` for an inline schema, which is a real limit rather than a bug: an unexported
 * value has no name a `.d.ts` can import.
 */
function exportedNameOf(
  schema: unknown,
  moduleExports: Readonly<Record<string, unknown>>,
): string | undefined {
  if (schema === undefined || schema === null) return undefined
  for (const [name, value] of Object.entries(moduleExports)) {
    // Reference identity, never structural comparison: two distinct schemas can be deeply equal,
    // and emitting the wrong name would type the client against the wrong contract silently.
    if (value === schema) return name
  }
  return undefined
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
  for (const { filePath, cls, exports } of modules) {
    const className = (cls as { name: string }).name
    for (const walk of walkControllerMetadata(cls)) {
      const bodySchemaExport = exportedNameOf(walk.bodySchema, exports)
      // `walk.querySchema` is DECLARED on `WalkResult` and never populated — `walkControllerMetadata`
      // resolves a body schema and has no query counterpart, so the field always reads `undefined`
      // (grep: the only occurrence in `@theokit/http` is its own declaration). Reading the entry
      // directly is therefore not a shortcut around an API; it is the only place the schema exists.
      //
      // Deliberately NOT fixed by populating `querySchema` here: that field feeds runtime validation
      // for `@Body`, so filling the query one would start VALIDATING query strings that are not
      // validated today. This issue is about editor types; silently turning on runtime rejection
      // under it would be a behaviour change nobody asked for. Filed separately.
      const queryEntry = walk.paramEntries.find(
        (e) => e.source === 'query' && e.schema !== undefined,
      )
      const querySchemaExport = exportedNameOf(queryEntry?.schema, exports)
      out.push({
        filePath,
        className,
        fullPath: walk.fullPath,
        verb: walk.verb,
        methodName: String(walk.propertyKey),
        ...(bodySchemaExport !== undefined ? { bodySchemaExport } : {}),
        ...(querySchemaExport !== undefined ? { querySchemaExport } : {}),
        ...((walk.bodySchema !== undefined && bodySchemaExport === undefined) ||
        (queryEntry?.schema !== undefined && querySchemaExport === undefined)
          ? { schemaNotExported: true }
          : {}),
      })
    }
  }
  return out
}
