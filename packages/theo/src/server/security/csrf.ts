import type { IncomingMessage } from 'node:http'

import type { AuditLogger } from '../observability/audit-log.js'
import { safeAudit } from '../observability/audit-log.js'

/**
 * CSRF enforcement mode.
 *
 * - `off`     — skip CSRF entirely. Use only when you have another defense
 *               (e.g. you don't ship session cookies, all auth is bearer).
 * - `warn`    — log a structured warning when the check would fail, but
 *               still serve the request. Default for 0.2.0. Migration mode.
 * - `strict`  — reject failing requests with 403 + code `CSRF_INVALID`.
 *               Will become the default in 0.3.0.
 */
export type CsrfMode = 'off' | 'warn' | 'strict'

/**
 * Per-request structured logger surface. Only `warn` is used by enforceCsrf;
 * we don't require a full Logger here so callers can pass a mock or the
 * console directly.
 */
export interface CsrfLogger {
  warn: (payload: CsrfWarnPayload) => void
  /** Optional path the request was destined for — used for log correlation. */
  path?: string
}

/**
 * T5.1 — Rails-inspired per-route escalation.
 *
 * `routes` accepts string (exact match) or RegExp entries. When a request
 * path matches AND the request would otherwise emit a warning, the
 * `behavior` field decides what happens:
 *
 *   - `'warn'`  → normal warn dispatch (no-op vs default)
 *   - `'raise'` → escalate to 403 regardless of global `csrf` mode
 *
 * `'raise'` never downgrades: when global mode is `'off'`, validation is
 * skipped entirely and disallowed dispatch never runs.
 */
export interface DisallowedConfig {
  routes: (string | RegExp)[]
  behavior: 'warn' | 'raise'
}

/**
 * Test whether `path` matches any of the supplied patterns. String
 * patterns are EXACT (trailing slash matters — use RegExp for tolerance).
 *
 * EC-5: when a RegExp carries the `/g` flag, `.test()` mutates
 * `lastIndex` and the next invocation may miss. We reset `lastIndex`
 * before each test so the matcher is a pure function.
 */
export function matchDisallowed(path: string, patterns: readonly (string | RegExp)[]): boolean {
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (path === p) return true
    } else if (p instanceof RegExp) {
      p.lastIndex = 0
      if (p.test(path)) return true
    }
    // Neither string nor RegExp: ignore silently (defensive — the public
    // type forbids it but runtime data may slip past).
  }
  return false
}

/**
 * T2.2 — Stable cutover identifier shipped with every csrf.warn payload.
 *
 * Convention borrowed from Vite's `deprecations.ts:74` — a `code` plus a
 * `docsUrl` lets users (a) grep their logs for a single stable identifier
 * to find every csrf.warn line, and (b) click through directly to the
 * migration guide. Strings are exported constants so the analyzer (T2.3)
 * and migration guide can reference the same source of truth.
 */
export const CSRF_WARN_CODE = 'CSRF_STRICT_CUTOVER' as const
export const CSRF_WARN_DOCS_URL = 'https://theokit.dev/upgrade/csrf-strict-cutover' as const

/**
 * Pick a header value, choosing the first entry when an array (Node sets
 * arrays for headers that legitimately appear multiple times). Returns
 * `''` when the header is absent or empty — callers treat `''` as "skip".
 */
function pickHeader(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.length > 0) return value[0]
  return ''
}

export interface CsrfWarnPayload {
  event: 'csrf.warn'
  method: string
  path: string | undefined
  reason: string
  /**
   * Stable identifier for the 0.2 → 0.3 CSRF strict cutover. Always
   * `'CSRF_STRICT_CUTOVER'`. Grep-able from prod logs.
   */
  code: string
  /**
   * Link to the section of the migration guide explaining how to clear
   * this specific warning class.
   */
  docsUrl: string
}

/**
 * T5a.2 Phase B (slice 1/6): pure header-only CSRF check extracted from
 * `validateCsrf(req: IncomingMessage)` so it can be re-used by the Web-
 * Standards `validateCsrfRequest(request: Request)` sibling. Per the T5a.2
 * plan v1.0 § Phase B, header-only leaves are first to migrate. This is
 * the dual-signature pattern (anti-pattern #2 avoidance): IncomingMessage
 * consumers unchanged; new Request consumers go through the same logic
 * via the shared helper.
 *
 * Pure logic — accepts pre-extracted header values as strings or null.
 */
function isCsrfValidFromHeaders(opts: {
  csrfActionHeader: string | null
  origin: string | null
  host: string | null
}): { valid: true } | { valid: false; reason: string } {
  // 1. Custom header must be present (primary defense — simple form posts
  //    cannot set custom headers, browsers gate via CORS preflight)
  if (opts.csrfActionHeader !== '1') {
    return { valid: false, reason: 'Missing X-Theo-Action header' }
  }

  // 2. Origin matching (secondary defense)
  if (opts.origin === null || opts.origin === '') {
    // Browsers omit Origin for same-origin requests — treat as valid
    return { valid: true }
  }

  if (opts.host === null || opts.host === '') {
    return { valid: true }
  }

  try {
    const originHost = new URL(opts.origin).host
    if (originHost !== opts.host) {
      return { valid: false, reason: `Origin ${opts.origin} does not match host ${opts.host}` }
    }
  } catch {
    return { valid: false, reason: `Invalid origin: ${opts.origin}` }
  }

  return { valid: true }
}

export function validateCsrf(
  req: IncomingMessage,
): { valid: true } | { valid: false; reason: string } {
  // IncomingMessage adapter — normalize Node header shape to the pure
  // helper's input shape (string|null).
  const action = req.headers['x-theo-action']
  const origin = req.headers.origin
  const host = req.headers.host
  return isCsrfValidFromHeaders({
    csrfActionHeader: typeof action === 'string' ? action : null,
    origin: origin !== undefined ? pickHeader(origin) || null : null,
    host: host !== undefined ? pickHeader(host) || null : null,
  })
}

/**
 * T5a.2 Phase B (slice 1/6) — Web-Standards-shaped CSRF validator.
 *
 * Mirror of `validateCsrf(req: IncomingMessage)` for the Web `Request`
 * shape. Consumes `request.headers.get(name)` (native Web `Headers` API)
 * instead of `req.headers[name]` (Node `IncomingMessage` indexer). Same
 * CSRF policy + same return shape — the difference is only the input
 * extraction.
 *
 * Used by `executeWebRequest` (T5a.2 Phase A) to enforce CSRF on the
 * Web-Standards request handler entry-point.
 */
export function validateCsrfRequest(
  request: Request,
): { valid: true } | { valid: false; reason: string } {
  return isCsrfValidFromHeaders({
    csrfActionHeader: request.headers.get('x-theo-action'),
    origin: request.headers.get('origin'),
    host: request.headers.get('host'),
  })
}

/**
 * Enforce CSRF policy with mode-aware behavior. Wrapper over `validateCsrf`
 * that turns the boolean valid/invalid into a request-level allow decision,
 * gated by mode + structured warning in warn mode.
 *
 * Phase 5 — CSRF warn-first (EC-1). See plan docs/plans/nextjs-maturity-plan.md.
 */
/**
 * Dispatch the csrf.warn payload to both the structured logger and the
 * audit sink (when configured). Extracted from `enforceCsrf` to keep that
 * function's complexity within ceiling.
 */
function dispatchCsrfWarn(
  req: IncomingMessage,
  reason: string,
  logger: CsrfLogger | undefined,
  auditLogger: AuditLogger | undefined,
  pathFallback = '',
): void {
  const payload: CsrfWarnPayload = {
    event: 'csrf.warn',
    method: req.method ?? 'UNKNOWN',
    path: logger?.path ?? pathFallback,
    reason,
    code: CSRF_WARN_CODE,
    docsUrl: CSRF_WARN_DOCS_URL,
  }
  logger?.warn(payload)
  // `metadata` is typed as Record<string, unknown>; CsrfWarnPayload is a
  // structurally-equivalent shape but lacks the index signature.
  safeAudit(auditLogger, {
    action: 'csrf.warn',
    actor: { type: 'anonymous' },
    metadata: { ...payload },
  })
}

export function enforceCsrf(
  req: IncomingMessage,
  mode: CsrfMode,
  logger?: CsrfLogger,
  disallowed?: DisallowedConfig,
  auditLogger?: AuditLogger,
): { allow: boolean; reason?: string } {
  if (mode === 'off') {
    // `off` short-circuits before disallowed dispatch — users who set
    // csrf: 'off' globally have explicitly turned validation off, and
    // disallowed must never re-introduce it. The escape hatch is to
    // set csrf: 'warn' and use disallowed for surgical strict pockets.
    return { allow: true }
  }

  const check = validateCsrf(req)
  if (check.valid) {
    return { allow: true }
  }

  // T5.1 — disallowed dispatch: when the failing request matches a
  // disallowed pattern AND behavior is 'raise', escalate to 403 even if
  // global mode is 'warn'. Strict mode would 403 anyway, so the branch
  // is a no-op there.
  if (disallowed?.behavior === 'raise') {
    const path = logger?.path ?? req.url ?? ''
    if (matchDisallowed(path, disallowed.routes)) {
      return { allow: false, reason: check.reason }
    }
  }

  if (mode === 'warn') {
    // T2.1: emit via warnOnce by default — callers can override via the
    // injected logger.warn (tests, custom log routers).
    // T2.2: include the stable cutover code + docsUrl so logs are
    // grep-able and click-through-able.
    dispatchCsrfWarn(req, check.reason, logger, auditLogger)
    return { allow: true, reason: check.reason }
  }

  // strict — 403 the request, AND emit a warn payload so the dev (and
  // devtools UI) sees WHY it was blocked + the docsUrl to fix it.
  // Without this, strict-mode users get a silent 403 with no context.
  dispatchCsrfWarn(req, check.reason, logger, auditLogger)
  return { allow: false, reason: check.reason }
}
