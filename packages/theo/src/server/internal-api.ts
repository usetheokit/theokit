/**
 * server/internal-api — the EXPLICIT internal contract `server/` exposes to its
 * build-time consumers (`vite-plugin/`, `cli/`).
 *
 * This is NOT the public API. The public surface is `server/index.ts`
 * (`theokit/server`). This file exists so build-layer consumers import from a
 * single, stable path instead of reaching into `server/<subdir>/<file>.ts`
 * (architecture.md Invariant 3 — public/cross-module imports flow through a
 * barrel, not the internal file layout). Reorganizing server internals now only
 * touches THIS file, not the 9 vite-plugin modules that consume it.
 *
 * Rule: add a symbol here only when a cross-module build-time consumer needs it.
 * Do NOT re-export these from the public `server/index.ts` — they are internal.
 */

// --- http ---
export { executeAction } from './http/action-execute.js'
export { executeRoute, sendError } from './http/execute.js'
export { dispatchControllerRequest } from './http/controller-dispatch.js'
export { incomingMessageToHandlerRequest } from './http/node-request.js'
export { handleBatchRequest, BATCH_PATH } from './http/batch-handler.js'
export { createCorsHandler } from './http/cors.js'
export type { CorsConfig } from './http/cors.js'
export { extractTraceId, TRACE_HEADER } from './http/trace-context.js'

// --- observability ---
export { logRequest } from './observability/logger.js'
export { findSuggestion } from './observability/suggest.js'
export type { AuditLogger } from './observability/audit-log.js'

// --- plugins ---
export { createPluginRunnerFromConfig } from './plugins/load-plugins.js'
export type { PluginRunner } from './plugins/plugin-runner.js'

// --- rate-limit ---
export { createRateLimiter } from './rate-limit/rate-limit.js'
export type { RateLimitConfig } from './rate-limit/rate-limit.js'

// --- scan ---
export { scanServerActions, scanServerActionsEnriched } from './scan/action-scan.js'
export type { ActionManifestEntry } from './scan/action-scan.js'
// The isomorphic-schema convention, named once. The server-only import boundary in the Vite plugin
// must not refuse the one directory the actions facade deliberately bundles into the client.
export { ACTION_SCHEMAS_DIR } from './scan/action-scan.js'
export { scanAgents } from './scan/agent-scan.js'
export { mountAgent } from './agent/mount-agent.js'
export { resolveProvider } from './agent/provider-resolver.js'
export { createViteLoader, type LoadModule } from './scan/module-loader.js'
export { matchRoute } from './scan/match.js'
export { scanServerRoutes } from './scan/scan.js'
export { generateManifest } from './scan/manifest.js'
export type { ManifestRoute, TheoManifest } from './scan/manifest.js'
/**
 * Consumed by GENERATED CODE, not by any import that exists in this repository.
 *
 * The Bun, Cloudflare and Deno adapters **emit** `import { scanWebSocketRoutes } from
 * 'theokit/server'` inside template strings (`adapters/bun.ts:55`, `adapters/cloudflare.ts:42`,
 * `adapters/deno-deploy.ts:32`). No static analyzer sees an import that only comes into existence
 * when the build writes the file — and Knip, correctly from where it stands, reports this re-export
 * as unused.
 *
 * Removing it would kill WebSocket support on all three deploy targets **at runtime**, with no test
 * and no typecheck saying a word. The tag below tells Knip; this comment tells the next human.
 *
 * @knipignore
 */
export { scanWebSocketRoutes } from './scan/ws-scan.js'

// --- security ---
export type { CsrfMode, DisallowedConfig } from './security/csrf.js'
export { CSP_REPORT_PATH, handleCspReport } from './security/csp-report.js'
export type { CspReportHandlerOptions } from './security/csp-report.js'
export { handleCsrfReadiness } from './security/csrf-readiness-endpoint.js'
export { CsrfReadinessStore } from './security/csrf-readiness-store.js'
export { applySecurityHeaders } from './security/security-headers.js'
export type { SecurityHeadersConfig } from './security/security-headers.js'

// --- auth ---
export { generateNonce } from './auth/nonce.js'
