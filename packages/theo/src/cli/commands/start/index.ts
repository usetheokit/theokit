/**
 * theokit start — production server orchestration spine.
 *
 * T4.2 (architecture-cleanup, ADR-0017): stages extracted to sibling modules.
 *   - start-bootstrap-stages.ts   — config/registry/storage bootstrap + resolveSsrEntry
 *   - start-manifest-loader.ts    — manifest.json or scan fallback
 *   - start-ssr-setup.ts          — SSR entry-server + HTML template split
 *   - start-handlers.ts           — branch handlers (action/route/static/404)
 *   - start-request-handler.ts    — request lifecycle wiring
 *   - start-websocket-handler.ts  — WS upgrade (opt-in)
 *   - start-graceful-shutdown.ts  — SIGTERM/SIGINT drain
 */

import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

import { loadConfig } from '../../../config/load-config.js'
import { loadEnv } from '../../../config/load-env.js'
import { initCacheEngineFromConfig } from '../../../server/cache-bootstrap.js'
import { createCronScheduler } from '../../../server/cron/cron-runtime-node.js'
import { defineHealthRoute } from '../../../server/define/health-route.js'
import { createPluginRunnerFromConfig } from '../../../server/plugins/load-plugins.js'
import { createRouteRateLimiter } from '../../../server/rate-limit/rate-limit-per-route.js'
import { createProductionLoader } from '../../../server/scan/module-loader.js'
import { resolveTransformer } from '../../../server/transformer.js'
import { preflightNodeAndBindings } from '../../preflight-node-version.js'
import { CONTROLLER_MANIFEST_FILE } from '../build/emit-controllers.js'

import { assertSdkCompatible } from './assert-sdk-compatible.js'
import {
  configureAgentRegistryFromConfig,
  configureStorageManagerFromConfig,
} from './bootstrap-stages.js'
import { loadCronDefinitions } from './cron-bootstrap.js'
import { installGracefulShutdown } from './graceful-shutdown.js'
import type { RequestHandlerCtx } from './handlers.js'
import { loadRoutesAndActions } from './manifest-loader.js'
import { createRequestHandler } from './request-handler.js'
import { setupSsr } from './ssr-setup.js'
import { attachWebSocketHandler } from './websocket-handler.js'

// Backwards-compat: external test fixtures may import resolveSsrEntry from here.
export { resolveSsrEntry } from './bootstrap-stages.js'

interface StartOptions {
  port?: number
}

export async function startCommand(options: StartOptions): Promise<void> {
  const cwd = process.cwd()
  // Preflight (FIRST — BEFORE anything that touches native bindings).
  preflightNodeAndBindings(cwd)
  loadEnv({ cwd, mode: 'production' })
  const config = await loadConfig(cwd)

  // M48 — fail fast if the installed @theokit/sdk is present but incompatible (before serving any
  // request). Absent SDK stays silent here (an api-only app is valid); the request path guards it lazily.
  assertSdkCompatible()

  await configureAgentRegistryFromConfig(config.agents?.registry)
  await configureStorageManagerFromConfig(config.storage)
  // #352 — without this, `revalidateTag` / `revalidatePath` / `updateTag` throw
  // in every application: they resolve the engine from a singleton nothing
  // initialized.
  await initCacheEngineFromConfig(config.cache)

  const distDir = resolve(cwd, '.theokit')
  const clientDir = resolve(distDir, 'client')
  // theokit#123 — compiled controllers, when `theokit build` emitted any.
  //
  // Keyed on the MANIFEST rather than on the directory existing: a stale `dist/controllers` left by
  // an earlier build whose sources were since deleted would otherwise keep serving routes the app
  // no longer declares. `theokit build` writes the manifest only when it compiles something, and
  // `cleanOutDir` removes both, so the manifest is the authoritative "this build has controllers".
  const controllersDistDir = existsSync(resolve(distDir, CONTROLLER_MANIFEST_FILE))
    ? resolve(distDir, 'controllers')
    : undefined
  // #95 — honor config `serverDir` (default "server") in production start, matching dev.
  const serverDir = resolve(cwd, config.serverDir)

  if (!existsSync(clientDir)) {
    throw new Error('No build found. Run `theo build` first.')
  }

  const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf-8')
  const loadModule = createProductionLoader()
  const port = options.port ?? config.port
  const pluginRunner = await createPluginRunnerFromConfig(config.plugins)
  const transformer = resolveTransformer(config.serialization)

  const custom404Path = join(clientDir, '404.html')
  const custom500Path = join(clientDir, '500.html')
  const custom404Html = existsSync(custom404Path) ? readFileSync(custom404Path, 'utf-8') : null
  const custom500Html = existsSync(custom500Path) ? readFileSync(custom500Path, 'utf-8') : null

  const {
    routes: cachedRoutes,
    actions: cachedActions,
    wsRoutes: cachedWsRoutes,
    agents: cachedAgents,
  } = loadRoutesAndActions(distDir, serverDir, config.agentsDir)

  // `createRouteRateLimiter` accepts BOTH config shapes — it detects the legacy flat form and
  // treats it as the default bucket — so one call covers everything the schema allows.
  //
  // The previous code built a limiter only for the flat shape, on the belief that the per-route
  // variant was handled by an api-middleware path. No such path runs under `theokit start`, so a
  // per-route config produced `null` here and `handlers.ts` skipped limiting on every request. The
  // app booted clean, the config validated, and nothing was ever limited — see
  // usetheokit/theokit#321. A config that validates and then does nothing is worse than one that
  // fails loudly, because the operator has no reason to look.
  const rateLimiter = config.rateLimit ? createRouteRateLimiter(config.rateLimit) : null

  const ssr = await setupSsr({
    distDir,
    indexHtml,
    ssrConfigEnabled: config.ssr,
    ssrStreamingConfig: config.ssrStreaming,
  })

  const server = createServer(
    createRequestHandler({
      buildCtx: (req, res, requestId, startTime): RequestHandlerCtx => ({
        req,
        res,
        url: req.url ?? '/',
        requestId,
        startTime,
        clientDir,
        custom404Html,
        cachedRoutes,
        cachedActions,
        cachedAgents,
        loadModule,
        serverDir,
        projectRoot: cwd,
        controllersDistDir,
        pluginRunner,
        transformer,
        csrfMode: config.security?.csrf ?? 'strict',
        disallowed: config.security?.disallowed,
        rateLimiter,
      }),
      securityHeadersConfig: config.security?.headers ?? {},
      ssrRender: ssr.render,
      ssrRenderStreaming: ssr.renderStreaming,
      ssrStreamingEnabled: ssr.streamingEnabled,
      htmlHead: ssr.htmlHead,
      htmlTail: ssr.htmlTail,
      indexHtml,
      custom500Html,
      // M7-2: serve a built-in liveness route on the Node listener. Readiness
      // probe wiring from theo.config.ts is a documented follow-up (see the M7
      // implementation summary § Scope note).
      reservedRoutes: { health: defineHealthRoute() },
    }),
  )

  await attachWebSocketHandler(server, cachedWsRoutes, loadModule)

  // theokit#324: `theokit build --target node` announces an in-process
  // scheduler here. Drive it, or the announcement is false.
  const cronDefinitions = await loadCronDefinitions(resolve(distDir, 'crons.json'), cwd, loadModule)
  if (cronDefinitions.length > 0) {
    createCronScheduler(cronDefinitions).start()
  }

  server.listen(port, () => {
    console.log(`\n  Theo production server`)
    console.log(`  → http://localhost:${String(port)}\n`)
    if (cronDefinitions.length > 0) {
      console.log(`  Crons: ${String(cronDefinitions.length)} scheduled in-process\n`)
    }
  })

  installGracefulShutdown(server)
}
