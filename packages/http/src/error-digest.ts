/**
 * Error digestion — converts any thrown value into a stable hash + context.
 *
 * Inspired by Next.js `create-error-handler.tsx`. Produces a deterministic
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
  phase?: 'guard' | 'interceptor' | 'handler' | 'filter' | 'agent'
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
    return JSON.stringify(err)
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
