import { z } from 'zod'

import { headerSafeString } from './header-safe.js'

/**
 * Phase 5 — CSRF warn-first (EC-1).
 *
 * 0.2.0 default: `warn`. Existing apps keep working but get structured
 * warnings about every state-mutating request that does not carry the
 * `X-Theo-Action: 1` header. 0.3.0 will flip the default to `strict`.
 *
 * Set explicitly to `strict` to opt into the future default early,
 * or `off` to disable CSRF entirely (only valid when you have another
 * defense — bearer auth, no session cookies, etc).
 */

/**
 * Phase 6 — Default security headers (D4 / EC-2).
 *
 * 0.2.0 defaults:
 *   - CSP in `report-only` mode (EC-2: don't break existing apps)
 *   - X-Frame-Options: DENY · X-Content-Type-Options: nosniff
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - HSTS in production only (no TLS on localhost)
 *
 * Users override individual headers, swap CSP to `enforce`, or disable
 * CSP entirely (`csp: false` / `cspMode: 'off'`).
 */
export const securityHeadersSchema = z.object({
  csp: z.union([headerSafeString, z.literal(false)]).optional(),
  // T6.1 — default flipped from 'report-only' to 'enforce' for 0.3.0.
  // Users who want the old behaviour set `cspMode: 'report-only'`
  // explicitly. See docs/migrating/0.2-to-0.3.md.
  cspMode: z.enum(['enforce', 'report-only', 'off']).default('enforce'),
  hsts: z.union([headerSafeString, z.literal(false)]).optional(),
  frameOptions: z.enum(['DENY', 'SAMEORIGIN']).default('DENY'),
  contentTypeOptions: z.literal('nosniff').default('nosniff'),
  referrerPolicy: headerSafeString.default('strict-origin-when-cross-origin'),
  /**
   * T1.1 — Permissions-Policy directive string. EC-3-refined: rejects CR/LF.
   * Pass `false` to suppress the header.
   */
  permissionsPolicy: z.union([headerSafeString, z.literal(false)]).optional(),
})

/**
 * T5.1 — Disallowed-routes escalation pattern (Rails-inspired).
 *
 * `routes` accepts string (exact match — trailing slash matters) or
 * RegExp entries. Matched routes that would otherwise emit `csrf.warn`
 * dispatch through `disallowedBehavior` instead:
 *   - `'warn'`  : no-op vs the default warn-mode behavior
 *   - `'raise'` : escalate to 403, even when global `csrf` mode is 'warn'
 *
 * Use to roll out strict mode per-route (e.g., flip /api/auth/* first)
 * without committing the entire surface to strict at once.
 */
export const disallowedConfigSchema = z.object({
  routes: z.array(z.union([z.string(), z.instanceof(RegExp)])),
  behavior: z.enum(['warn', 'raise']).default('raise'),
})

/**
 * T1.2 — CORS configuration.
 *
 * `origins` accepts a single value (`'*'`, string, RegExp, callback) OR an
 * array of (string | RegExp). The spec-violating `origins: '*'` +
 * `credentials: true` combination is rejected at parse time (browsers
 * ignore wildcards when credentials are sent).
 *
 * EC-3 — `allowedHeaders` and `exposedHeaders` entries go through the
 * header-safe refinement (CR/LF rejected — CWE-113 mitigation).
 */
export const corsSchema = z
  .object({
    origins: z.union([
      z.literal('*'),
      headerSafeString,
      z.instanceof(RegExp),
      z.array(z.union([headerSafeString, z.instanceof(RegExp)])),
      z.function({ input: z.tuple([z.string()]), output: z.boolean() }),
    ]),
    methods: z
      .array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']))
      .optional(),
    allowedHeaders: z.array(headerSafeString).optional(),
    exposedHeaders: z.array(headerSafeString).optional(),
    credentials: z.boolean().default(false),
    maxAge: z.number().int().min(0).max(86400).default(600),
  })
  .refine((c) => !(c.origins === '*' && c.credentials), {
    message: 'CORS spec forbids origins:"*" with credentials:true — browsers ignore the wildcard',
  })

export const securitySchema = z.object({
  // T6.1 — default flipped from 'warn' to 'strict' for 0.3.0. Apps that
  // grep their warn-mode logs from 0.2.x already know which endpoints
  // break; opt back into 'warn' globally OR use disallowedRoutes for
  // surgical migration. See docs/migrating/0.2-to-0.3.md.
  csrf: z.enum(['off', 'warn', 'strict']).default('strict'),
  headers: securityHeadersSchema.optional(),
  /** T5.1 — per-route escalation (Rails disallowed_warnings pattern). */
  disallowed: disallowedConfigSchema.optional(),
  /** T1.2 — Cross-Origin Resource Sharing. Single global config; runs first in pipeline. */
  cors: corsSchema.optional(),
})
