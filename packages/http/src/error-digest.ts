/**
 * Error digestion — converts any thrown value into a stable hash + context.
 *
 * Produces a deterministic
 * digest ID suitable for logging and client-safe error references without
 * leaking stack traces in production.
 *
 * Uses djb2 hash (sync, no crypto dependency) per ADR D3.
 */

import { HttpException } from './exceptions/http-exception.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorContext {
  route?: string
  /**
   * `'construction'` is the controller never coming into existence — distinct from `'handler'`,
   * which is its method throwing. #577: the first has no instance to blame and takes out every
   * route on the class, so an operator reading a digest needs to tell the two apart.
   */
  phase?: 'construction' | 'guard' | 'interceptor' | 'handler' | 'filter' | 'agent'
  source?: string
}

export interface DigestedError {
  digest: string
  message: string
  status: number
  context: ErrorContext
  stack?: string
}

// ---------------------------------------------------------------------------
// djb2 hash — deterministic, sync, no crypto dependency
// ---------------------------------------------------------------------------

function djb2(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    // hash * 33 + charCode — classic djb2
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  // Convert to unsigned 32-bit hex
  return (hash >>> 0).toString(16)
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Converts any thrown value into a structured {@link DigestedError}.
 *
 * - Sync (never async) — safe to call inside catch blocks.
 * - Stack trace stripped when `process.env.NODE_ENV === 'production'`.
 * - Preserves {@link HttpException} status codes.
 * - Handles non-Error throws (string, number, object).
 */
export function digestError(err: unknown, context: ErrorContext = {}): DigestedError {
  const message = extractMessage(err)
  const status = extractStatus(err)
  const rawStack = extractStack(err)

  const digest = djb2(message)

  const isProduction = process.env.NODE_ENV === 'production'

  return {
    digest,
    message,
    status,
    context,
    ...(rawStack && !isProduction ? { stack: rawStack } : {}),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  if (typeof err === 'string') {
    return err
  }
  if (typeof err === 'number') {
    return String(err)
  }
  // object / null / undefined / symbol / bigint
  try {
    const json = JSON.stringify(err)
    // B-214. `JSON.stringify` returns the VALUE `undefined` — not a string — for `undefined`, for
    // symbols and for functions. The `catch` below covers only BigInt, which throws. So this
    // returned `undefined` under a `: string` annotation, and `digestError` then called
    // `djb2(message)`, whose first statement reads `input.length`: a TypeError, raised inside the
    // handler that called this to make an arbitrary thrown value safe.
    //
    // `throw undefined` and `throw Symbol()` are legal JavaScript and arrive here through any
    // `catch (err: unknown)`. `String` is total over every one of those kinds where
    // `JSON.stringify` is not — `'undefined'`, `'Symbol(s)'`, the function's source — and a
    // template literal would not be: `${symbol}` throws.
    return typeof json === 'string' ? json : String(err)
  } catch {
    return 'Unknown error'
  }
}

function extractStatus(err: unknown): number {
  if (err instanceof HttpException) {
    return err.statusCode
  }
  return 500
}

function extractStack(err: unknown): string | undefined {
  if (err instanceof Error) {
    return err.stack
  }
  return undefined
}
