/* eslint-disable security/detect-non-literal-fs-filename --
 * Vite plugin entry. Reads `package.json` + checks for ts vs js source
 * layout under `theoSrcDir` (build-time literal). No HTTP input.
 */
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Plugin } from 'vite'

import type { CorsConfig } from '../server/http/cors.js'
import type { AuditLogger } from '../server/observability/audit-log.js'
import type { PluginRunner } from '../server/plugins/plugin-runner.js'
import type { RateLimitConfig } from '../server/rate-limit/rate-limit.js'
import type { CsrfReadinessStore } from '../server/security/csrf-readiness-store.js'
import type { DisallowedConfig } from '../server/security/csrf.js'
import type { SecurityHeadersConfig } from '../server/security/security-headers.js'
import type { TheoTransformer } from '../server/transformer.js'
import { type ServicesConfig } from '../services/index.js'

// T2.1-T2.3 (architecture-medium-deferrals) + T2.6 (M6) — sibling extractions.
import { runConfigHook } from './config-hook.js'
import { resolvePluginConfig, type ResolvedOpenApi } from './config-resolve.js'
import { runConfigureServer } from './configure-server-hook.js'
import { integrateUseTheoUI } from './integrate-ui.js'
import { resolveTheoRootDir } from './resolve-theo-root.js'
import type { TheoUiDetectResult } from './theoui-detect.js'
import { runTransformIndexHtml } from './transform-html-hook.js'
import {
  loadVirtualModule,
  resolveVirtualModuleId,
  type VirtualModuleIds,
} from './virtual-modules-hook.js'

export {
  defineTheoIntegration,
  createIntegrationRegistry,
  IntegrationRouteCollisionError,
  IntegrationVirtualModulePrefixError,
} from './integrations.js'
export type {
  TheoIntegration,
  HookName as IntegrationHookName,
  Hook as IntegrationHook,
  HookContext as IntegrationHookContext,
  IntegrationRegistry,
  IntegrationRegistryOptions,
  IntegrationRoute,
  RouteHandler as IntegrationRouteHandler,
} from './integrations.js'

const VIRTUAL_ENTRY_ID = '/@theo/entry-client'
const RESOLVED_ENTRY_ID = '\0@theo/entry-client'
const VIRTUAL_MANIFEST_ID = '/@theo/route-manifest'
const RESOLVED_MANIFEST_ID = '\0@theo/route-manifest'
const VIRTUAL_ENTRY_SERVER_ID = '/@theo/entry-server'
const RESOLVED_ENTRY_SERVER_ID = '\0@theo/entry-server'
const VIRTUAL_RUNTIME_CONFIG_ID = '/@theo/runtime-config'
const RESOLVED_RUNTIME_CONFIG_ID = '\0@theo/runtime-config'

export interface TheoPluginOptions {
  root?: string
  rateLimit?: RateLimitConfig
  ssr?: boolean
  ssrStreaming?: boolean
  /**
   * Wave 2 (T3.1) — polyglot services config. When passed, the
   * services-typed-client plugin is wired and generates `clients/<name>.ts`
   * per service with an OpenAPI URL. Empty `{}` → no-op.
   */
  services?: ServicesConfig
  /**
   * T4.1 (canvas-ecosystem-refactor / ADR D6) — extra package names appended
   * to Vite `optimizeDeps.include`. Required when an installed plugin
   * peer-dep is consumed via a literal `import('<pkg>')` (dynamic specifier)
   * — Vite cannot trace those without a hint, and the browser receives a
   * `Failed to resolve module specifier '<pkg>'` error.
   *
   * Default targets pre-bundled regardless: `@theokit/ui`, `lucide-react`.
   *
   * Example:
   *   viteOptimizeDeps: ['mermaid']
   */
  viteOptimizeDeps?: string[]
  /**
   * Optional override for the in-memory CSRF readiness store consumed by
   * the `/__theo/csrf-readiness` endpoint and the devtools CSRF Readiness
   * tab. When omitted, the plugin auto-instantiates a default in-process
   * `CsrfReadinessStore` so the tab works out-of-the-box in dev.
   *
   * Override with a custom impl when you need cross-worker telemetry
   * (e.g., Redis-backed store) or want to silence the tab entirely
   * (pass an inert store that discards writes).
   */
  csrfReadinessStore?: CsrfReadinessStore
}

/**
 * T3.3 — Find a consumer-side config file (`tailwind.config.*`, `postcss.config.*`)
 * by walking from projectRoot up to 3 levels. Returns the absolute path on the
 * first hit, or `undefined`. Used to defer to consumer's manual config (D3).
 */
function findConsumerConfig(projectRoot: string, basename: string): string | undefined {
  const extensions = ['.ts', '.js', '.mjs', '.cjs']
  let dir = projectRoot
  for (let level = 0; level < 3; level++) {
    for (const ext of extensions) {
      const candidate = resolve(dir, `${basename}${ext}`)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * Async factory companion. Returns `[theoPlugin, ...autoChainedPlugins]`.
 *
 * Why this exists alongside the sync `theoPlugin()` factory: Vite does NOT
 * reliably merge plugins returned from a child plugin's `config()` hook
 * (verified empirically 2026-05-23 — plugins were silently dropped from
 * the resolved chain despite being returned correctly). The canonical
 * Vite pattern for plugin-from-plugin is to return `Plugin[]` from the
 * plugin factory itself, which Vite flattens into the consumer's
 * `plugins` array.
 *
 * Consumers should prefer `await theoPluginAsync(...)` over `theoPlugin(...)`
 * when they want @theokit/ui + @tailwindcss/vite auto-chaining. The sync
 * factory remains for backward compatibility and tests.
 */
export async function theoPluginAsync(
  rootOrOptions?: string | TheoPluginOptions,
): Promise<Plugin[]> {
  const options =
    typeof rootOrOptions === 'string' ? { root: rootOrOptions } : (rootOrOptions ?? {})
  const projectRoot = options.root ?? process.cwd()

  const consumerTailwindConfig = findConsumerConfig(projectRoot, 'tailwind.config')
  const consumerPostcssConfig = findConsumerConfig(projectRoot, 'postcss.config')
  const uiPlugins = await integrateUseTheoUI(projectRoot, {
    consumerTailwindConfig,
    consumerPostcssConfig,
  })

  // Wave 2 (T3.1) — typed-client plugin wired only when services declared.
  // Empty `services: {}` (default) → plugin is a no-op (no fetch fired).
  const servicesPlugins: Plugin[] = []
  if (options.services && Object.keys(options.services).length > 0) {
    const { servicesTypedClientPlugin } = await import('./services-typed-client.js')
    servicesPlugins.push(
      servicesTypedClientPlugin({
        cwd: projectRoot,
        services: options.services,
      }),
    )
  }

  // G1 — app typed client (`@theo/client`). Always wired (route detection is
  // cheap and the plugin is a no-op when `server/routes/` is absent).
  const { appTypedClientPlugin } = await import('./app-typed-client.js')
  const appClientPlugin = appTypedClientPlugin({
    cwd: projectRoot,
    serverDir: resolve(projectRoot, 'server'),
    distDir: resolve(projectRoot, '.theo'),
  })

  // G3 — actions virtual module (`@theo/actions`). Always wired; the plugin
  // emits an empty `{}` facade when `server/actions/` is absent so consumers
  // can still `import { actions } from '@theo/actions'` without breakage.
  // The `distDir` opt enables `.theo/actions.d.ts` emit so TS resolves the
  // virtual module ambient declaration in consumer apps.
  const { actionsVirtualModule } = await import('./actions-virtual-module.js')
  const actionsPlugin = actionsVirtualModule({
    serverDir: resolve(projectRoot, 'server'),
    distDir: resolve(projectRoot, '.theo'),
  })

  // G6 T1.2 — server-routes HMR. Watches `<serverDir>/routes/**` and
  // invalidates SSR module cache + sends full-reload on any add/change/unlink
  // with a 50 ms debounce per EC-6.
  const { serverRoutesHmrPlugin } = await import('./server-routes-hmr.js')
  const routesHmrPlugin = serverRoutesHmrPlugin({
    serverDir: resolve(projectRoot, 'server'),
  })

  return [
    theoPlugin(rootOrOptions),
    ...uiPlugins,
    ...servicesPlugins,
    appClientPlugin,
    actionsPlugin,
    routesHmrPlugin,
  ]
}

/**
 * Build the `optimizeDeps.include` array Vite uses to pre-bundle heavy
 * deps at server startup. Detects `@theokit/ui` and `lucide-react` in
 * the consumer's `node_modules` (auto-include) and appends user-declared
 * peer deps via `viteOptimizeDeps` (e.g., `mermaid` for plugin-canvas
 * — without this hint Vite fails to resolve dynamic `import('mermaid')`
 * inside an installed plugin at dev time). T4.1 of canvas-ecosystem-refactor.
 */
function buildOptimizeDepsInclude(
  projectRoot: string,
  viteOptimizeDeps: readonly string[] | undefined,
): string[] {
  const include: string[] = []
  if (existsSync(resolve(projectRoot, 'node_modules', '@theokit', 'ui'))) {
    include.push('@theokit/ui')
  }
  if (existsSync(resolve(projectRoot, 'node_modules', 'lucide-react'))) {
    include.push('lucide-react')
  }
  // T7.1 — devalue is a peer of the @theo/actions virtual module facade.
  // Without this include hint, Vite import-analysis fails to resolve the
  // facade's `await import('devalue')` from the consumer context (devalue
  // lives in theokit's node_modules subtree, not the consumer root).
  include.push('devalue')
  if (Array.isArray(viteOptimizeDeps)) {
    for (const pkg of viteOptimizeDeps) {
      if (typeof pkg === 'string' && pkg.length > 0 && !include.includes(pkg)) {
        include.push(pkg)
      }
    }
  }
  return include
}

const VIRTUAL_MODULE_IDS: VirtualModuleIds = {
  VIRTUAL_ENTRY_ID,
  RESOLVED_ENTRY_ID,
  VIRTUAL_MANIFEST_ID,
  RESOLVED_MANIFEST_ID,
  VIRTUAL_ENTRY_SERVER_ID,
  RESOLVED_ENTRY_SERVER_ID,
  VIRTUAL_RUNTIME_CONFIG_ID,
  RESOLVED_RUNTIME_CONFIG_ID,
}

export function theoPlugin(rootOrOptions?: string | TheoPluginOptions): Plugin {
  const options =
    typeof rootOrOptions === 'string' ? { root: rootOrOptions } : (rootOrOptions ?? {})
  const projectRoot = options.root ?? process.cwd()
  const appDir = resolve(projectRoot, 'app')
  const ssrEnabled = options.ssr ?? false

  // Resolve paths for SSR module loading. Pure helper extracted for T1.3
  // regression test — see resolve-theo-root.ts for branch documentation.
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const theoSrcDir = resolveTheoRootDir(currentDir)

  // EC-1: plugin runner cached in module closure. Instantiated in configResolved
  // (non-HMR-able). theo.config.ts edits during dev emit a warn but do NOT
  // re-instantiate — user must restart dev server for plugin changes.
  let pluginRunner: PluginRunner | undefined
  let transformer: TheoTransformer | undefined
  let resolvedBatching: { max?: number } | undefined
  let theoUi: TheoUiDetectResult | undefined
  let csrfMode: 'off' | 'warn' | 'strict' = 'strict'
  let securityHeaders: SecurityHeadersConfig | undefined
  let disallowed: DisallowedConfig | undefined
  // T1.2 — CORS config resolved from theo.config.ts; passed to api-middleware.
  let cors: CorsConfig | undefined
  // T4.1 — Audit logger from theo.config.ts.audit.logger
  let auditLogger: AuditLogger | undefined
  // T1.2 — devtools opt-out. `false` skips injection; anything else enables (dev only).
  let devtoolsEnabled = true
  // P#3 T1.1 — OpenAPI dev-emit config. undefined = opt-out (no behavior).
  let resolvedOpenApi: ResolvedOpenApi | undefined
  let resolvedDistDir = '.theo'
  // Dev mode flag set in configureServer. transformIndexHtml runs in both
  // dev and build; we only want to inject during dev. Wrapped in a ref
  // struct so sub-hooks (configure-server-hook, transform-html-hook) can
  // observe mutations across hook boundaries without losing identity.
  const isDevModeRef = { value: false }
  let configLoadedOnce = false

  return {
    name: 'theo',

    async configResolved() {
      // T2.1 (architecture-medium-deferrals, ADR D2) — config-load logic
      // extracted to `config-resolve.ts`. This hook owns only the one-shot
      // semantic and the closure-variable assignment.
      if (configLoadedOnce) return
      configLoadedOnce = true
      const resolved = await resolvePluginConfig(projectRoot)
      pluginRunner = resolved.pluginRunner
      transformer = resolved.transformer
      resolvedBatching = resolved.resolvedBatching
      theoUi = resolved.theoUi
      csrfMode = resolved.csrfMode
      securityHeaders = resolved.securityHeaders
      disallowed = resolved.disallowed
      cors = resolved.cors
      auditLogger = resolved.auditLogger
      devtoolsEnabled = resolved.devtoolsEnabled
      resolvedOpenApi = resolved.openapi
      resolvedDistDir = resolved.distDir
    },

    // T2.6 (M6) — config() body extracted to config-hook.ts. The hook
    // owns optimizeDeps + warmup + services proxy + alias cascade.
    // The @theokit/ui + @tailwindcss/vite auto-chain lives in
    // `theoPluginAsync` because Vite drops plugins returned from a
    // child plugin's config() hook.
    config() {
      return runConfigHook({
        projectRoot,
        theoSrcDir,
        services: options.services,
        optimizeDepsInclude: buildOptimizeDepsInclude(projectRoot, options.viteOptimizeDeps),
      })
    },

    // T2.6 (M6) — transformIndexHtml hook extracted to transform-html-hook.ts.
    // Preserves the canonical 3-step order (entry-client → devtools → styles)
    // so EC-10 (Vite hook ordering side effects) is honored.
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string): string {
        return runTransformIndexHtml(html, {
          isDevMode: isDevModeRef,
          devtoolsEnabled,
          projectRoot,
        })
      },
    },

    // T2.6 (M6) — virtual-module resolveId + load dispatch extracted to
    // virtual-modules-hook.ts. Pure structural split; identity branches
    // preserved.
    resolveId(id: string) {
      return resolveVirtualModuleId(id, VIRTUAL_MODULE_IDS)
    },

    load(id: string) {
      return loadVirtualModule(id, {
        ids: VIRTUAL_MODULE_IDS,
        appDir,
        ssrEnabled,
        streamingEnabled: options.ssrStreaming === true,
        theoUi,
        transformer,
      })
    },

    // T2.6 (M6) — configureServer body extracted to configure-server-hook.ts.
    // The hook owns middleware order, ws subscriptions, watcher handlers,
    // OpenAPI re-emit, and WS upgrade. EC-10 honored (every effect preserved
    // in its original ordering).
    async configureServer(server) {
      await runConfigureServer(server, {
        projectRoot,
        appDir,
        resolvedDistDir,
        ssrEnabled,
        isDevMode: isDevModeRef,
        pluginRunner,
        transformer,
        resolvedBatching,
        csrfMode,
        securityHeaders,
        disallowed,
        cors,
        auditLogger,
        resolvedOpenApi,
        services: options.services,
        rateLimit: options.rateLimit,
        csrfReadinessStoreOverride: options.csrfReadinessStore,
        virtualEntryServerId: VIRTUAL_ENTRY_SERVER_ID,
        resolvedManifestId: RESOLVED_MANIFEST_ID,
      })
    },
  }
}
