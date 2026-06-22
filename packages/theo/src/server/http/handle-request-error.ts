import type { IncomingMessage, ServerResponse } from 'node:http'

import { isAuthRequiredError } from '../../core/contracts/auth-error-guard.js'
import { envelopeCodeToStatus } from '../../core/contracts/envelope-code-to-status.js'
import { serverErrorToEnvelope } from '../../core/contracts/server-error-to-envelope.js'
import type { PluginContext } from '../plugin-types.js'
import type { PluginRunner } from '../plugins/plugin-runner.js'

import { sendError } from './send-response.js'

/**
 * Canonical error handler for HTTP request pipelines (T3.4 of
 * architecture-review-remediation-plan, PV-9 DRY).
 *
 * Replaces the duplicated catch-block logic in `executeRoute` (1 site) and
 * `executeAction` (1 site, via `handleActionError`). Both code paths now
 * share this implementation.
 *
 * Behavior contract (preserved from previous inline catches):
 * - Plugin `onError` fires first (swallowed if it throws — never amplify failure).
 * - `AuthRequiredError` is detected via `instanceof` AND a duck-type shape
 *   check (`code === 'AUTH_REQUIRED' && status === 401`) — required because
 *   under Vite dev / vitest the module-loader can produce a duplicate
 *   AuthRequiredError class identity, breaking `instanceof`.
 * - `onResponse({ inErrorPath: true })` always fires at the end (swallowed
 *   if it throws — EC-9).
 */
export interface HandleRequestErrorCtx {
  req: IncomingMessage
  res: ServerResponse
  requestId: string | undefined
  pluginRunner: PluginRunner | undefined
  buildPluginCtx: (ctxObj: Record<string, unknown>) => PluginContext
}

export async function handleRequestError(err: unknown, c: HandleRequestErrorCtx): Promise<void> {
  // 1. onError hook — swallowed on failure (EC-9 — never amplify)
  if (c.pluginRunner) {
    const errCtxObj: Record<string, unknown> = {}
    c.pluginRunner.applyDecorations(errCtxObj)
    try {
      await c.pluginRunner.runOnError(c.buildPluginCtx(errCtxObj), err)
    } catch {
      // onError handlers must never destabilize the response.
    }
    // EC-9: response may already have been ended by an onError hook
    if (c.res.writableEnded) {
      try {
        await c.pluginRunner.runOnResponse(c.buildPluginCtx(errCtxObj), {
          inErrorPath: true,
        })
      } catch {
        // Containment (same as above).
      }
      return
    }
  }

  // 2. Auth error detection (shape-based guard from core/contracts)
  if (isAuthRequiredError(err)) {
    const authErr = err as { code: string; message: string; status: number }
    sendError(c.res, authErr.code, authErr.message, authErr.status, undefined, c.requestId)
  } else {
    // M7-1: mirror handleWebRequestError — route every other error through the
    // typed envelope so a thrown TheoError (incl. NotFoundError) carries its
    // code + mapped status instead of a generic 500. envelopeCodeToStatus has
    // no sub-400 entries, so the status is always >= 400 (defaults to 500).
    const envelope = serverErrorToEnvelope(err)
    sendError(
      c.res,
      envelope.code,
      envelope.message,
      envelopeCodeToStatus(envelope.code),
      undefined,
      c.requestId,
    )
  }

  // 3. onResponse(inErrorPath) — swallowed on failure (EC-9)
  if (c.pluginRunner) {
    const errCtxObj: Record<string, unknown> = {}
    c.pluginRunner.applyDecorations(errCtxObj)
    try {
      await c.pluginRunner.runOnResponse(c.buildPluginCtx(errCtxObj), {
        inErrorPath: true,
      })
    } catch {
      // Containment.
    }
  }
}

/**
 * T5a.2 Phase G slice 3/N — Web-Standards request error handler.
 *
 * Mirror of `handleRequestError(err, c: HandleRequestErrorCtx)` for the
 * Web `Request` shape. Returns a native `Response` directly instead of
 * mutating `res`. Same behavioral contract:
 *
 *   1. Auth-error detection via `instanceof AuthRequiredError` PLUS a
 *      duck-type fallback (`code === 'AUTH_REQUIRED' && status === 401`)
 *      — needed because Vite dev / vitest can produce duplicate class
 *      identities, breaking `instanceof`.
 *   2. Envelope-shaped JSON body using `serverErrorToEnvelope` (G5 D3
 *      boundary translation).
 *   3. Status code derived from envelope.code via `envelopeCodeToStatus`
 *      mirror (already implemented inline in web-handler.ts; this slice
 *      uses the same mapping table).
 *
 * **Difference vs IncomingMessage path:** the Web path's plugin runner
 * orchestration lives in `executeWebRequest`'s `runWithHooks` /
 * `runErrorHooks` (Phase G slice 1/N) — `handleWebRequestError` is the
 * leaf that builds the error Response WITHOUT touching plugin hooks.
 * Callers compose: `executeWebRequest` (or future Web execute pipeline)
 * catches a throw, calls `handleWebRequestError(err, { requestId })` to
 * build the Response, then routes through onError hooks separately.
 */
export interface HandleWebRequestErrorCtx {
  requestId?: string
}

export async function handleWebRequestError(
  err: unknown,
  ctx: HandleWebRequestErrorCtx = {},
): Promise<Response> {
  // Lazy import to avoid pulling the full envelope translator into the
  // bundle for consumers who don't hit the error path. Same dynamic-
  // import pattern as web-handler.ts's parseBodyFull.
  const { serverErrorToEnvelope } = await import('../../core/contracts/server-error-to-envelope.js')

  // 1. Auth-error detection (shape-based guard from core/contracts)
  if (isAuthRequiredError(err)) {
    const authErr = err as { code?: string; message?: string; status?: number }
    return new Response(
      JSON.stringify({
        code: authErr.code ?? 'AUTH_REQUIRED',
        message: authErr.message ?? 'Authentication required',
      }),
      {
        status: authErr.status ?? 401,
        headers: {
          'content-type': 'application/json',
          ...(ctx.requestId !== undefined ? { 'x-request-id': ctx.requestId } : {}),
        },
      },
    )
  }

  // 2. Envelope translation for everything else (G5 D3 boundary).
  const envelope = serverErrorToEnvelope(err)
  return new Response(JSON.stringify(envelope), {
    status: envelopeCodeToStatus(envelope.code),
    headers: {
      'content-type': 'application/json',
      ...(ctx.requestId !== undefined ? { 'x-request-id': ctx.requestId } : {}),
    },
  })
}

// envelopeCodeToStatus extracted to core/contracts/envelope-code-to-status.ts
// (architecture-remediation T1.2, 2026-06-12)
