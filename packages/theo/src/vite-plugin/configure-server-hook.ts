import { resolve, basename } from 'node:path'

import type { ViteDevServer } from 'vite'

import { broadcastRouteManifest } from '../devtools/server-side/route-manifest.js'
import { scanRoutes } from '../router/scan.js'
import { isRouteFile } from '../router/types.js'
import {
  CsrfReadinessStore,
  type AuditLogger,
  type CorsConfig,
  type DisallowedConfig,
  type PluginRunner,
  type RateLimitConfig,
  type SecurityHeadersConfig,
} from '../server/internal-api.js'
import type { TheoTransformer } from '../server/transformer.js'
import type { ServicesConfig } from '../services/index.js'

import { createActionMiddleware } from './action-middleware.js'
import { createAgentMiddleware } from './agent-middleware.js'
import { createApiMiddleware } from './api-middleware.js'
import type { ResolvedOpenApi } from './config-resolve.js'
import { setupSsrDevMiddleware } from './ssr-dev-middleware.js'
import { setupWsUpgrade } from './ws-upgrade.js'

/**
 * Inputs assembled by `theoPlugin` from its closure variables + the
 * resolvedOpenApi from `config-resolve.ts`. Kept as a struct so the
 * extraction is a pure pass-through with no behavior change.
 */
interface ConfigureServerCtx {
  projectRoot: string
  appDir: string
  /** Absolute backend root (config `serverDir`, default `<projectRoot>/server`) — route/action scan (#95). */
  serverDir: string
  /** Agents dir NAME (config `agentsDir`, default "agents") relative to projectRoot — agent-middleware scan. */
  agentsDir: string
  resolvedDistDir: string
  ssrEnabled: boolean
  isDevMode: { value: boolean }
  pluginRunner: PluginRunner | undefined
  transformer: TheoTransformer | undefined
  resolvedBatching: { max?: number } | undefined
  csrfMode: 'off' | 'warn' | 'strict'
  securityHeaders: SecurityHeadersConfig | undefined
  disallowed: DisallowedConfig | undefined
  cors: CorsConfig | undefined
  auditLogger: AuditLogger | undefined
  resolvedOpenApi: ResolvedOpenApi | undefined
  services: ServicesConfig | undefined
  rateLimit: RateLimitConfig | undefined
  csrfReadinessStoreOverride: CsrfReadinessStore | undefined
  virtualEntryServerId: string
  resolvedManifestId: string
}

/**
 * Runs the body of Vite's `configureServer` hook. Pure extraction —
 * preserves invocation order of every server.watcher event, middleware
 * registration, and ws hook so EC-10 (Vite hook ordering side effects)
 * is honored.
 */

export async function runConfigureServer(
  server: ViteDevServer,
  ctx: ConfigureServerCtx,
): Promise<void> {
  // T1.2 — mark dev mode so transformIndexHtml injects devtools script
  // and resolveId/load serve the virtual module. Build mode never calls
  // configureServer, so isDevMode stays false and injection is skipped.
  ctx.isDevMode.value = true

  // T2.4 — expose dev server WS to server-side broadcast helper
  ;(globalThis as { __theoViteHotServer?: typeof server }).__theoViteHotServer = server

  // T3.1 — re-broadcast the route manifest when the devtools bridge asks.
  server.ws.on('theo:devtools:request-manifest', () => {
    try {
      const tree = scanRoutes(ctx.appDir)
      broadcastRouteManifest(tree)
    } catch {
      /* fail silently — dev-only convenience */
    }
  })

  // Server middleware (action before API — more specific prefix first). `serverDir` honors the
  // config `serverDir` (default `<projectRoot>/server`) — no longer hardcoded (#95).
  const serverDir = ctx.serverDir
  server.middlewares.use(
    createActionMiddleware(server, serverDir, {
      pluginRunner: ctx.pluginRunner,
      csrfMode: ctx.csrfMode,
      disallowed: ctx.disallowed,
    }),
  )
  // M2 — agent convention (`/api/agents/<name>`) before the generic api-middleware
  // (mirrors the action prefix). Agents live at <projectRoot>/agents (LOCKED naming).
  // CSRF is enforced in `mountAgent` (shared dev+prod point) at the same mode as routes.
  server.middlewares.use(
    createAgentMiddleware(server, ctx.projectRoot, ctx.csrfMode, ctx.agentsDir),
  )
  // Wave 2 completion — services-proxy prefixes flow through to the
  // api-middleware so it can call `next()` for paths that should be
  // forwarded to a sidecar by Vite's proxyMiddleware.
  const servicesProxyPrefixes =
    ctx.services && Object.keys(ctx.services).length > 0
      ? Object.values(ctx.services).map((s) => s.proxy)
      : []
  // Auto-instantiate a dev-only CsrfReadinessStore so the devtools
  // CSRF Readiness tab works out-of-the-box.
  const csrfReadinessStore = ctx.csrfReadinessStoreOverride ?? new CsrfReadinessStore()
  server.middlewares.use(
    createApiMiddleware(server, serverDir, {
      rateLimitConfig: ctx.rateLimit,
      pluginRunner: ctx.pluginRunner,
      batching: ctx.resolvedBatching,
      transformer: ctx.transformer,
      csrfMode: ctx.csrfMode,
      securityHeaders: ctx.securityHeaders,
      disallowed: ctx.disallowed,
      cors: ctx.cors,
      auditLogger: ctx.auditLogger,
      servicesProxyPrefixes,
      csrfReadinessStore,
    }),
  )

  // EC-1: warn if theo.config.ts is edited during dev session.
  const configPath = resolve(ctx.projectRoot, 'theo.config.ts')
  server.watcher.on('change', (file) => {
    if (file === configPath) {
      console.warn(
        '\n[theokit] theo.config.ts changed; restart dev server for plugin changes to take effect\n',
      )
    }
  })

  // T2.2 (architecture-medium-deferrals) — SSR dev middleware extracted.
  if (ctx.ssrEnabled) {
    setupSsrDevMiddleware(server, {
      projectRoot: ctx.projectRoot,
      virtualEntryServerId: ctx.virtualEntryServerId,
      securityHeaders: ctx.securityHeaders,
    })
  }

  // Frontend HMR watcher
  function handleRouteChange(filePath: string): void {
    if (!isRouteFile(basename(filePath))) return
    if (!filePath.startsWith(ctx.appDir)) return

    const mod = server.moduleGraph.getModuleById(ctx.resolvedManifestId)
    if (mod) {
      server.moduleGraph.invalidateModule(mod)
      server.ws.send({ type: 'full-reload' })
    }
  }

  server.watcher.on('add', handleRouteChange)
  server.watcher.on('unlink', handleRouteChange)

  // P#3 T1.1 — Dev-mode OpenAPI emit. Gated on config.openapi !== undefined.
  if (ctx.resolvedOpenApi !== undefined) {
    const openApiCfg = ctx.resolvedOpenApi
    const { reEmitOpenApi } = await import('./openapi-emit/dev-emit.js')
    // #95 — the OpenAPI dev-emit scans the SAME backend root as the route middleware (honor serverDir).
    const openApiServerDir = ctx.serverDir
    const openApiDistDir = resolve(ctx.projectRoot, ctx.resolvedDistDir)
    const isRouteFileForOpenApi = (file: string): boolean =>
      file.startsWith(openApiServerDir) && /\.(ts|tsx|js|mjs)$/.test(file)
    // Boot emit (fire-and-forget — boot doesn't await)
    void reEmitOpenApi(openApiServerDir, openApiDistDir, openApiCfg)
    // Watcher emit
    server.watcher.on('change', (file: string) => {
      if (isRouteFileForOpenApi(file)) {
        void reEmitOpenApi(openApiServerDir, openApiDistDir, openApiCfg)
      }
    })
    server.watcher.on('add', (file: string) => {
      if (isRouteFileForOpenApi(file)) {
        void reEmitOpenApi(openApiServerDir, openApiDistDir, openApiCfg)
      }
    })
    server.watcher.on('unlink', (file: string) => {
      if (isRouteFileForOpenApi(file)) {
        void reEmitOpenApi(openApiServerDir, openApiDistDir, openApiCfg)
      }
    })
  }

  // T2.3 (architecture-medium-deferrals) — WS upgrade extracted to sibling.
  setupWsUpgrade(server, ctx.projectRoot)

  // T2.4 — clear devtools WS reference on shutdown
  server.httpServer?.once('close', () => {
    ;(globalThis as { __theoViteHotServer?: unknown }).__theoViteHotServer = undefined
  })
}
