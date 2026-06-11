import type { ServerResponse } from 'node:http'

import type { TheoTransformer } from '../transformer.js'

/**
 * Canonical HTTP response helpers (T5.1 extraction).
 *
 * Moved out of execute.ts so request-pipeline stages (execute-stages.ts,
 * handle-request-error.ts, etc.) can depend on these helpers without
 * creating a cycle through execute.ts.
 *
 * Public surface re-exported from execute.ts for backward compat — every
 * existing caller of `sendError` / `sendJson` continues to work via the
 * `theokit/server` barrel.
 */

export function sendJson(
  res: ServerResponse,
  data: unknown,
  status = 200,
  transformer?: TheoTransformer,
): void {
  // T1.2 — transformer-aware serialization. Default (no transformer) uses
  // JSON.stringify direct for backward compat.
  const body = transformer ? transformer.serialize(data) : JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

export interface SendErrorOptions {
  custom404Html?: string
  custom500Html?: string
}

/**
 * Canonical error response.
 *
 * T6.3 (PV-17): the positional 7-param signature is preserved for backward
 * compat. New call sites should use the options-bag form:
 *
 *   sendError(res, { code, message, status, issues?, requestId?, options? })
 *
 * Both shapes resolve to the same implementation.
 */
export interface SendErrorInput {
  code: string
  message: string
  status: number
  issues?: unknown[]
  requestId?: string
  options?: SendErrorOptions
}

export function sendError(res: ServerResponse, input: SendErrorInput): void
/* eslint-disable-next-line max-params -- T6.3: positional overload preserved
   for backward compat (callers across cli/server still use positional). The
   options-bag overload above is the recommended path. */
export function sendError(
  res: ServerResponse,
  code: string,
  message: string,
  status: number,
  issues?: unknown[],
  requestId?: string,
  options?: SendErrorOptions,
): void
/* eslint-disable-next-line max-params, complexity -- delegates to two
   surface overloads above; the branch density mirrors the back-compat
   contract, not internal complexity. */
export function sendError(
  res: ServerResponse,
  codeOrInput: string | SendErrorInput,
  message?: string,
  status?: number,
  issues?: unknown[],
  requestId?: string,
  options?: SendErrorOptions,
): void {
  let code: string
  if (typeof codeOrInput === 'string') {
    code = codeOrInput
    message = message ?? ''
    status = status ?? 500
  } else {
    code = codeOrInput.code
    message = codeOrInput.message
    status = codeOrInput.status
    issues = codeOrInput.issues
    requestId = codeOrInput.requestId
    options = codeOrInput.options
  }
  const errorMessage =
    code === 'INTERNAL_ERROR' && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : message

  if (code === 'INTERNAL_ERROR') {
    console.error(`[${requestId ?? 'no-id'}] ${message}`)
  }

  if (status === 404 && options?.custom404Html) {
    const body = options.custom404Html
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
    return
  }
  if (status === 500 && options?.custom500Html) {
    const body = options.custom500Html
    res.writeHead(500, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
    return
  }

  sendJson(
    res,
    {
      error: {
        code,
        message: errorMessage,
        ...(requestId ? { requestId } : {}),
        ...(issues ? { issues } : {}),
      },
    },
    status,
  )
}

/**
 * T5a.2 Phase G slice 4/N — Web-Standards response helpers.
 *
 * Mirror of `sendJson` + `sendError` for the Web `Request`/`Response`
 * shape. Returns a native `Response` directly instead of mutating a
 * `ServerResponse`.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase G.
 *
 * **Difference vs IncomingMessage path:**
 *   - No `Content-Length` set explicitly — the runtime computes it from
 *     the body when needed. CF Workers / Bun / Deno all do this; setting
 *     it manually risks conflict if the body is a stream rather than a
 *     fixed string.
 *   - Custom 404/500 HTML options preserved (same opts shape).
 *   - `requestId` flows into the response body's error envelope AND
 *     surfaces as `x-request-id` header (parity with handleWebRequestError
 *     Phase G slice 3/N).
 */
export function buildJsonResponse(
  data: unknown,
  status = 200,
  transformer?: TheoTransformer,
): Response {
  const body = transformer ? transformer.serialize(data) : JSON.stringify(data)
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function buildErrorResponse(input: SendErrorInput): Response {
  const { code, message, status, issues, requestId, options } = input
  const errorMessage =
    code === 'INTERNAL_ERROR' && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : message

  if (code === 'INTERNAL_ERROR') {
    console.error(`[${requestId ?? 'no-id'}] ${message}`)
  }

  const headers: Record<string, string> = {}
  if (requestId !== undefined) headers['x-request-id'] = requestId

  if (status === 404 && options?.custom404Html !== undefined) {
    headers['content-type'] = 'text/html; charset=utf-8'
    return new Response(options.custom404Html, { status: 404, headers })
  }
  if (status === 500 && options?.custom500Html !== undefined) {
    headers['content-type'] = 'text/html; charset=utf-8'
    return new Response(options.custom500Html, { status: 500, headers })
  }

  headers['content-type'] = 'application/json'
  const body = JSON.stringify({
    error: {
      code,
      message: errorMessage,
      ...(requestId ? { requestId } : {}),
      ...(issues ? { issues } : {}),
    },
  })
  return new Response(body, { status, headers })
}
