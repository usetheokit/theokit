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

/** Method names recognized as per-route named exports (UPPERCASE). */
const HTTP_METHOD_KEYS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export interface LoadRoutesOptions {
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
 */
export async function loadRoutesForOpenApi(
  options: LoadRoutesOptions,
): Promise<OpenApiManifestRoute[]> {
  const { serverDir, routes } = options
  const loadModule = options.loadModule ?? (await createDefaultLoader(serverDir))

  const out: OpenApiManifestRoute[] = []
  for (const r of routes) {
    const abs = resolve(serverDir, r.filePath)
    let mod: Record<string, unknown>
    try {
      mod = await loadModule(abs)
    } catch (err) {
      console.warn(`[openapi-emit] Skipping ${r.filePath}: load failed (${(err as Error).message})`)
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
 * import resolution for free. The server is closed by the caller via
 * the returned cleanup… except we close eagerly inline by wrapping the
 * loader to dispose after the calling batch completes.
 *
 * In practice the calling site (`loadRoutesForOpenApi`) doesn't hold the
 * server — it's created, used, closed in one shot via the IIFE pattern.
 */
async function createDefaultLoader(
  serverDir: string,
): Promise<(absPath: string) => Promise<Record<string, unknown>>> {
  // Vite is a peerDep in build flows; import dynamically.
  const { createServer } = await import('vite')
  const server = (await createServer({
    root: serverDir,
    configFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })) as unknown as ViteLikeServer

  let inflight = 0
  let closed = false
  const swallow = (): void => {
    /* eat close errors — best-effort cleanup */
  }
  return async (absPath: string) => {
    if (closed) throw new Error('vite-loader already closed')
    inflight++
    try {
      return await server.ssrLoadModule(absPath)
    } finally {
      inflight--
      if (inflight === 0) {
        queueMicrotask(() => {
          if (inflight === 0 && !closed) {
            closed = true
            void server.close().catch(swallow)
          }
        })
      }
    }
  }
}
