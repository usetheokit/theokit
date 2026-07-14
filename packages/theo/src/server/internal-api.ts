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
export {
  createControllerDispatcher,
  dispatchControllerRequest,
  type ControllerDispatcher,
} from './http/controller-dispatch.js'
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
export { scanAgents } from './scan/agent-scan.js'
export type { AgentNode } from './scan/agent-scan.js'
export { mountAgent } from './agent/mount-agent.js'
export { resolveProvider } from './agent/provider-resolver.js'
export { createViteLoader, type LoadModule } from './scan/module-loader.js'
export { matchRoute } from './scan/match.js'
export { scanServerRoutes } from './scan/scan.js'
export { generateManifest } from './scan/manifest.js'
export type { ManifestRoute, TheoManifest } from './scan/manifest.js'
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
