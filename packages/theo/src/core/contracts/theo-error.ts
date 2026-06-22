/**
 * `TheoError` — envelope-emitting `Error` subclass per plan
 * g5-error-envelope-cross-layer v1.0 § Phase 1 / T1.2.
 *
 * Mirrors trpc's TRPCError ergonomic pattern (referencia:
 * trpc/packages/server/src/unstable-core-do-not-import/error/TRPCError.ts:65-87)
 * adapted for theokit's hybrid envelope model (blueprint Form 4).
 *
 * Per ADR D5: `meta.stack` is auto-stripped in non-dev builds when serialized
 * via `toJSON()` — defense against accidental stack leak to clients (encore
 * `json:"-"` analog).
 *
 * Lives in `core/contracts/` per architecture.md v3 invariant #3.
 */

import type { TheoErrorCode, TheoErrorEnvelope } from './error-envelope.js'

/**
 * Constructor options. `code` and `message` are required; `cause` follows TC39
 * proposal-error-cause; `meta` and `ext` are opt-in per blueprint ADR D2.
 */
export interface TheoErrorOptions<TExt = unknown> {
  readonly code: TheoErrorCode
  readonly message: string
  readonly cause?: unknown
  readonly meta?: Record<string, unknown>
  readonly ext?: TExt
}

/**
 * `TheoError` — envelope-emitting Error subclass. Use this anywhere in
 * `theokit/server`, route handlers, or middleware to emit a typed,
 * cross-layer-compatible error.
 *
 * Mirrors TRPCError pattern: `code` is required, `message` defaults to
 * code if omitted, `cause` chain is preserved via TC39 proposal-error-cause.
 */
export class TheoError<TExt = unknown> extends Error {
  override readonly name = 'TheoError'
  readonly code: TheoErrorCode
  readonly meta?: Record<string, unknown>
  readonly ext?: TExt

  constructor(opts: TheoErrorOptions<TExt>) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.code = opts.code
    this.meta = opts.meta
    this.ext = opts.ext
  }

  /**
   * The canonical envelope view of this error. Use when crossing the wire
   * boundary or feeding telemetry — exposes the shape consumers can rely on
   * without depending on the class identity.
   */
  get envelope(): TheoErrorEnvelope<TExt> {
    return {
      code: this.code,
      message: this.message,
      cause: (this as Error & { cause?: unknown }).cause,
      meta: this.meta,
      ext: this.ext,
    }
  }

  /**
   * JSON serialization — emits envelope shape only (no name/stack class
   * internals). Per ADR D5, `meta.stack` is auto-stripped in non-dev to
   * prevent accidental leak; other meta keys are preserved.
   */
  toJSON(): TheoErrorEnvelope<TExt> {
    const meta = this.meta ? sanitizeMeta(this.meta) : undefined
    return {
      code: this.code,
      message: this.message,
      cause: (this as Error & { cause?: unknown }).cause,
      meta,
      ext: this.ext,
    }
  }
}

/**
 * Strip server-only sensitive meta keys in non-dev builds. Per ADR D5,
 * `stack` is the canonical leak vector (trpc accidentally exposes it via
 * `config.isDev` even today — references/trpc getErrorShape.ts:29-31).
 * Default to safe-by-default; preserve in dev only.
 */
function sanitizeMeta(meta: Record<string, unknown>): Record<string, unknown> | undefined {
  // Treat anything other than NODE_ENV === 'development' as production-safe
  // (CI, staging, production all strip). Matches the security posture in
  // blueprint EC-5 (default STRICT).
  if (process.env.NODE_ENV === 'development') {
    return meta
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'stack') continue
    out[k] = v
  }
  return out
}

/**
 * Coerce any unknown value into a TheoError envelope.
 *
 * - If value is already a TheoError, returns it unchanged (no double-wrap).
 * - If value is a plain Error, wraps it as `INTERNAL_SERVER_ERROR` with
 *   `cause` chain preserving the original.
 * - Other values (string, undefined, object) are coerced safely with a
 *   meaningful message.
 *
 * Use at framework boundaries (route handler catch-all, middleware catch,
 * SDK egress) to ensure every error crossing the wire carries an envelope.
 */
/**
 * `NotFoundError` — typed 404. A `TheoError` with code `NOT_FOUND`, so it
 * carries a stable `code` (not a bare status literal) and maps to HTTP 404 via
 * `envelopeCodeToStatus`. Throw it from a `defineRoute` handler for ergonomic
 * 404s (M7-1).
 */
export class NotFoundError extends TheoError {
  constructor(message = 'Not Found', meta?: Record<string, unknown>) {
    super({ code: 'NOT_FOUND', message, ...(meta !== undefined ? { meta } : {}) })
  }
}

export function fromUnknown(value: unknown): TheoError {
  if (value instanceof TheoError) return value
  if (value instanceof Error) {
    return new TheoError({
      code: 'INTERNAL_SERVER_ERROR',
      message: value.message,
      cause: value,
    })
  }
  if (typeof value === 'string') {
    return new TheoError({ code: 'INTERNAL_SERVER_ERROR', message: value })
  }
  if (value === undefined || value === null) {
    return new TheoError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unknown error' })
  }
  // Object / number / boolean / etc. — best-effort stringify
  return new TheoError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `Non-Error value thrown: ${safeStringify(value)}`,
    cause: value,
  })
}

/**
 * Best-effort stringify of an unknown value for error message context.
 * JSON.stringify first (preserves shape for diagnostics); on cycle/BigInt/symbol
 * failure, signal explicitly instead of falling back to `[object Object]`.
 */
function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'bigint') return `${value.toString()}n`
  if (typeof value === 'symbol') return value.toString()
  try {
    return JSON.stringify(value)
  } catch {
    return '[unstringifiable value]'
  }
}
