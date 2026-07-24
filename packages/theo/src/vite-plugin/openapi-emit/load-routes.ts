/**
 * Build-time route loader for OpenAPI emit.
 *
 * Takes the G1 manifest (filePath + routePath + methods) and hydrates each
 * route's Zod schemas by dynamically importing the module. `defineRoute`
 * is an identity function, so the imported config exposes `body/query/
 * params/response` directly without any AST gymnastics.
 *
 * Supports both export shapes:
 *   1. `export const POST = defineRoute({...})` (per-method named exports)
 *   2. `export default defineRoute({...})` (single-export legacy shape)
 *
 * Per G2 plan v1.1 T2.2. Uses Vite's `ssrLoadModule` because route files
 * are TS at build time — Node's native loader doesn't transpile.
 */
import { resolve } from 'node:path'

import type { z } from 'zod'

import type { ManifestRoute } from '../../server/scan/manifest.js'

import type { OpenApiManifestRoute } from './emit.js'

interface RouteConfigShape {
  body?: z.ZodType
  query?: z.ZodType
  params?: z.ZodType
  response?: z.ZodType
}

interface ViteLikeServer {
  ssrLoadModule: (id: string) => Promise<Record<string, unknown>>
  close: () => Promise<void>
}

interface DefaultLoader {
  load: (absPath: string) => Promise<Record<string, unknown>>
  dispose: () => Promise<void>
}

/** Method names recognized as per-route named exports (UPPERCASE). */
const HTTP_METHOD_KEYS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

interface LoadRoutesOptions {
  serverDir: string
  routes: ManifestRoute[]
  /** Injectable for tests; defaults to a fresh Vite SSR dev server. */
  loadModule?: (absPath: string) => Promise<Record<string, unknown>>
}

/**
 * Hydrate manifest routes with Zod schemas extracted from their modules.
 *
 * Returns one `OpenApiManifestRoute` per (file × method) tuple. If a route
 * file declares multiple methods (`GET` + `POST`), each method gets its
 * own entry with the schemas from that method's `defineRoute()` call.
 *
 * Routes that fail to load are skipped with a console warning — the emit
 * should be best-effort, not a hard build failure.
 *
 * The default Vite loader is created once per call and disposed in the
 * `finally` block so the underlying server is released even when route
 * loading throws.
 */
export async function loadRoutesForOpenApi(
  options: LoadRoutesOptions,
): Promise<OpenApiManifestRoute[]> {
  const { serverDir, routes } = options
  let loadModule = options.loadModule
  let dispose: (() => Promise<void>) | undefined
  if (loadModule === undefined) {
    const created = await createDefaultLoader(serverDir)
    loadModule = created.load
    dispose = created.dispose
  }

  const out: OpenApiManifestRoute[] = []
  try {
    for (const r of routes) {
      const abs = resolve(serverDir, r.filePath)
      let mod: Record<string, unknown>
      try {
        mod = await loadModule(abs)
      } catch (err) {
        console.warn(
          `[openapi-emit] Skipping ${r.filePath}: load failed (${(err as Error).message})`,
        )
        continue
      }

      const methods = r.methods ?? HTTP_METHOD_KEYS.filter((m) => mod[m] !== undefined)
      if (methods.length === 0) {
        // Fall back to default export when no method-named exports detected.
        const def = mod.default
        if (def !== undefined && def !== null) {
          out.push({ routePath: r.routePath, methods: ['GET'], ...extractSchemas(def) })
        }
        continue
      }

      for (const method of methods) {
        const handler = mod[method] ?? mod.default
        if (handler === undefined || handler === null) continue
        out.push({ routePath: r.routePath, methods: [method], ...extractSchemas(handler) })
      }
    }
  } finally {
    if (dispose !== undefined) {
      await dispose()
    }
  }
  return out
}

function extractSchemas(handlerExport: unknown): RouteConfigShape {
  if (typeof handlerExport !== 'object' || handlerExport === null) return {}
  const cfg = handlerExport as RouteConfigShape
  const out: RouteConfigShape = {}
  if (cfg.body !== undefined) out.body = cfg.body
  if (cfg.query !== undefined) out.query = cfg.query
  if (cfg.params !== undefined) out.params = cfg.params
  if (cfg.response !== undefined) out.response = cfg.response
  return out
}

/**
 * Default loader: spin up a minimal Vite SSR dev server (no HMR, no
 * middlewares) just to use its `ssrLoadModule`. Vite handles TS, ESM, and
 * import resolution for free.
 *
 * Returns `{load, dispose}` — the caller owns the lifecycle and MUST
 * call `dispose()` (typically in a `finally`) so the server is closed.
 */
async function createDefaultLoader(serverDir: string): Promise<DefaultLoader> {
  // Vite is a peerDep in build flows; import dynamically.
  const { createServer } = await import('vite')
  const server = (await createServer({
    root: serverDir,
    configFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })) as unknown as ViteLikeServer

  const swallow = (): void => {
    /* eat close errors — best-effort cleanup */
  }
  return {
    load: async (absPath) => server.ssrLoadModule(absPath),
    dispose: async () => {
      await server.close().catch(swallow)
    },
  }
}
