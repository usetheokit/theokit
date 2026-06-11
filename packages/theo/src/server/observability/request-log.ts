/**
 * Request log primitive (T6.2 of architecture-review-remediation-plan).
 *
 * Split out from `logger.ts` per PV-12 (SRP) — the file previously mixed
 * 3 concerns (factory, warnOnce, request log). This module owns ONLY the
 * `logRequest` flow + the devtools broadcast best-effort forwarder.
 *
 * Public API surface is unchanged — `logger.ts` re-exports `logRequest`
 * + `RequestLog` + `LoggerFn` for backward compat.
 */
import type { IncomingMessage } from 'node:http'

import { DEVTOOLS_BODY_PREVIEW } from '../body-parser.js'

export interface RequestLog {
  level: string
  method: string
  url: string
  status: number
  duration: number
  requestId: string
  timestamp: string
}

export type LoggerFn = (log: RequestLog) => void

const defaultLoggerFn: LoggerFn = (log) => {
  // eslint-disable-next-line no-console -- request-log default output IS the contract
  console.log(JSON.stringify(log))
}

export function logRequest(
  info: Omit<RequestLog, 'level' | 'timestamp'>,
  customLogger?: LoggerFn,
  req?: IncomingMessage,
): void {
  const log: RequestLog = {
    level: 'info',
    ...info,
    timestamp: new Date().toISOString(),
  }
  const logger = customLogger ?? defaultLoggerFn
  logger(log)
  // T2.1 — also broadcast to devtools (no-op in prod / when no dev server).
  // Pass `req` so the devtools forwarder can extract headers + body preview
  // stashed by body-parser (Symbol-keyed). Without `req`, only metadata
  // (method/path/status/duration) reaches the devtools UI — the expanded
  // row view then shows nothing useful.
  broadcastRequestToDevtools(info, req)
}

/**
 * T2.1 — Forward a request record to the devtools UI. Lazy import keeps
 * this module dep-free for prod; broadcast.ts internally guards on
 * `globalThis.__theoViteHotServer`.
 */
function randomRequestId(): string {
  // eslint-disable-next-line sonarjs/pseudo-random -- non-secret correlation id for devtools UI
  return `req-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * T5a.2 Phase C slice 2/2 — pure devtools broadcast that takes a
 * pre-extracted headers object + optional stashed body, so both
 * IncomingMessage and Web Request paths share the same dispatch logic.
 *
 * Errors here must not propagate — devtools forwarding is best-effort
 * and silenced.
 */
function broadcastToDevtoolsCore(
  info: Omit<RequestLog, 'level' | 'timestamp'>,
  headers: Record<string, string> | undefined,
  stashedBody: unknown,
): void {
  void Promise.all([
    import('../../devtools/server-side/broadcast.js'),
    import('../../devtools/server-side/build-request-body-preview.js'),
  ])
    .then(([{ broadcastRequest }, { buildRequestBodyPreview }]) => {
      const bodyInfo = buildRequestBodyPreview(stashedBody)
      broadcastRequest({
        id: randomRequestId(),
        traceId: info.requestId,
        method: info.method,
        path: info.url,
        status: info.status,
        durationMs: info.duration,
        startedAt: Date.now() - info.duration,
        ...(headers ? { headers } : {}),
        ...(bodyInfo
          ? {
              bodyPreview: bodyInfo.preview,
              bodyLength: bodyInfo.length,
              bodyTruncated: bodyInfo.truncated,
            }
          : {}),
      })
    })
    .catch(() => {
      // No-op: devtools forwarding is best-effort.
    })
}

function broadcastRequestToDevtools(
  info: Omit<RequestLog, 'level' | 'timestamp'>,
  req?: IncomingMessage,
): void {
  // T2.1 forwarder. Errors here must not propagate.
  const headers = req?.headers
    ? Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.join(', ') : (v ?? ''),
        ]),
      )
    : undefined
  const stashedBody = req
    ? (req as unknown as Record<symbol, unknown>)[DEVTOOLS_BODY_PREVIEW]
    : undefined
  broadcastToDevtoolsCore(info, headers, stashedBody)
}

/**
 * T5a.2 Phase C slice 2/2 — Web-Standards request log + devtools
 * forward. Mirror of `logRequest(info, logger?, req?: IncomingMessage)`
 * accepting `request?: Request`.
 *
 * Extracts headers via `request.headers.entries()` (Web `Headers`
 * iterator). Body preview stash is NOT yet supported on the Web path —
 * `body-parser-web.ts` doesn't yet stash like `body-parser.ts` does for
 * the IncomingMessage path. That hookup is Phase E scope (body parsing
 * migration). Until then, the devtools UI shows headers but no body
 * preview for Web-handled requests — same surface as the IncomingMessage
 * path before the stash convention shipped.
 */
export function logRequestFromRequest(
  info: Omit<RequestLog, 'level' | 'timestamp'>,
  customLogger?: LoggerFn,
  request?: Request,
): void {
  const log: RequestLog = {
    level: 'info',
    ...info,
    timestamp: new Date().toISOString(),
  }
  const logger = customLogger ?? defaultLoggerFn
  logger(log)

  let headers: Record<string, string> | undefined
  if (request) {
    headers = {}
    for (const [k, v] of request.headers.entries()) {
      headers[k] = v
    }
  }
  // Phase E will add body-preview stash on Web Request; for now no stash.
  broadcastToDevtoolsCore(info, headers, undefined)
}
