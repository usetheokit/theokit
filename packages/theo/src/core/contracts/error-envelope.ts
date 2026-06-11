/**
 * Error envelope — canonical cross-layer contract for theokit framework, SDK,
 * and UI per plan g5-error-envelope-cross-layer v1.0 § Phase 1 / T1.1.
 *
 * Blueprint G5 (SHIPPABLE_WITH_CAVEATS 89/100) — Form 4 Hybrid: shared CODE
 * enum + per-domain extensions + 2-layer SDK boundary translation.
 *
 * 3/3 references convergence: code + message + cause base (trpc TRPCError
 * + hono HTTPException + encore Error). Wasp confirms ecosystem gap.
 *
 * Reference anchors (verified file:line):
 * - referencia: trpc/packages/server/src/unstable-core-do-not-import/error/TRPCError.ts:65-87
 * - referencia: trpc/packages/server/src/unstable-core-do-not-import/rpc/codes.ts:11-44,76-81
 * - referencia: hono/src/http-exception.ts:46-78
 * - referencia: encore/runtimes/go/beta/errs/error.go:38-55 (Go — D4 disclaimer applied)
 *
 * Per blueprint ADR D2: retryable + hint are extension slots, NOT base fields
 * (3/3 references derive retryability from code identity; no reference ships
 * a `retryable: boolean` on envelope; `hint` is novel).
 *
 * Per blueprint ADR D5: server-only `meta` filtered at serializer boundary
 * (encore `json:"-"` analog).
 *
 * Lives in `core/contracts/` per architecture.md v3 — canonical home for
 * shared client↔server types. Zero intra-monorepo deps; zero runtime deps
 * (trpc + hono ship envelope with zero runtime deps per blueprint Q5).
 */

/**
 * Canonical TheoKit error code union. HTTP-status flavor + SDK/agent-domain
 * additions per blueprint Recommendations § concrete shape.
 *
 * String-literal union mirrors trpc's TRPC_ERROR_CODE_KEY pattern — enables
 * exhaustive `switch (env.code)` narrowing in consumer code (UI display
 * dispatch, retry-policy gates, telemetry classification).
 */
export type TheoErrorCode =
  // HTTP 4xx — client-side
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNPROCESSABLE_ENTITY'
  | 'TOO_MANY_REQUESTS'
  // HTTP 5xx — server-side
  | 'INTERNAL_SERVER_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'BAD_GATEWAY'
  | 'SERVICE_UNAVAILABLE'
  | 'GATEWAY_TIMEOUT'
  // SDK / agent-domain codes (translated from internal SDK class hierarchy at
  // boundary per blueprint ADR D3 — SDK keeps 15+ classes internally).
  | 'AGENT_RUN_ERROR'
  | 'PROVIDER_KEY_MISSING'
  | 'BUDGET_EXCEEDED'
  | 'RATE_LIMITED'
  | 'CREDENTIAL_POOL_EXHAUSTED'

/**
 * Base envelope shape — `{ code, message, cause?, meta?, ext? }`.
 *
 * `cause` follows TC39 proposal-error-cause (universal pattern, 3/3 references).
 * `meta` is server-only metadata filtered at serializer boundary per ADR D5
 * (`stack` is auto-stripped in non-dev builds — see T1.2 `TheoError.toJSON()`).
 * `ext` carries opt-in per-domain extensions (`ValidationFieldsExt`,
 * `RetryableExt`, `HintExt`, or arbitrary user-defined types via formatter hook).
 */
export interface TheoErrorEnvelope<TExt = unknown> {
  readonly code: TheoErrorCode
  readonly message: string
  readonly cause?: unknown
  readonly meta?: Record<string, unknown>
  readonly ext?: TExt
}

/**
 * `ValidationFieldsExt` — validation-failure extension carrying the dot-notation
 * field map identical to G3 `ActionInputError.fields`. Empty-string key for
 * root-level errors (mirrors G3 EC-7). Multiple messages per key are preserved.
 */
export interface ValidationFieldsExt {
  readonly fields: Record<string, string[]>
}

/**
 * `RetryableExt` — opt-in marker that the producer asserts the error IS retryable
 * even when the code alone wouldn't imply it. Carries optional `retryAfterMs` for
 * Retry-After-style hints. Per blueprint ADR D2, retryability is normally DERIVED
 * from `code` (see `RETRYABLE_CODES` set + `isRetryable`); this ext is for
 * producer overrides only.
 */
export interface RetryableExt {
  readonly retryable: true
  readonly retryAfterMs?: number
}

/**
 * `HintExt` — developer-facing remediation string. Per blueprint ADR D2, this
 * field is NOVEL (no reference ships it); kept off the base envelope and exposed
 * only via opt-in formatter hook to keep the wire shape minimal.
 */
export interface HintExt {
  readonly hint: string
}

/**
 * Canonical retryable codes set. Aligned with trpc's `retryableRpcCodes` pattern
 * (referencia: trpc/packages/server/src/unstable-core-do-not-import/rpc/codes.ts:76-81).
 *
 * Consumers SHOULD derive retry-policy via `isRetryable(env)` instead of a
 * field check — the canonical signal is code identity, not envelope shape.
 */
export const RETRYABLE_CODES: ReadonlySet<TheoErrorCode> = new Set<TheoErrorCode>([
  'BAD_GATEWAY',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
  'INTERNAL_SERVER_ERROR',
  'TOO_MANY_REQUESTS',
  'RATE_LIMITED',
])

/**
 * Derive retryability from envelope code identity. Pure function; no I/O.
 * Use this at retry-aware client boundaries (HTTP client interceptors,
 * agent provider retry loops, queue consumers).
 */
export function isRetryable(env: Pick<TheoErrorEnvelope, 'code'>): boolean {
  return RETRYABLE_CODES.has(env.code)
}
