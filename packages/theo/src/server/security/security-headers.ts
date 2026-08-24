import type { ServerResponse } from 'node:http'

import {
  buildSecurityHeaders,
  type SecurityEnv,
  type SecurityHeadersConfig,
  type SecurityHeadersOptions,
} from '../../core/contracts/security-headers.js'

/**
 * The Node half of the security-header baseline.
 *
 * The policy itself — what a configuration means, what the defaults are, how a
 * nonce enters the CSP — moved to `core/contracts/security-headers.ts` when the
 * deploy adapters started needing it too. `adapters → server` is not an edge in
 * the module DAG (ADR-0001 v3), and the honest reading of the violation was that
 * a pure `config → Record<string, string>` function had never been server code.
 *
 * What stays here is the one part that genuinely is: writing that map onto a
 * Node `ServerResponse`.
 *
 * Everything from core is re-exported so `theokit/server/security` keeps the
 * surface it published.
 */
export * from '../../core/contracts/security-headers.js'

/**
 * Apply security headers to a Node ServerResponse. Called by the
 * api-middleware before the route handler runs. The handler can override
 * any header via `res.setHeader()` — last write wins by Node convention.
 */
export function applySecurityHeaders(
  res: ServerResponse,
  config: SecurityHeadersConfig,
  env: SecurityEnv,
  options: SecurityHeadersOptions = {},
): void {
  const headers = buildSecurityHeaders(config, env, options)
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value)
  }
}
