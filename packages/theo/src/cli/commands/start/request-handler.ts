/**
 * Inline request handler for `theokit start` (T4.2 architecture-cleanup).
 *
 * Wires the per-request flow: security headers → action/route/static branches
 * → SSR fallback → CSR fallback → 500 page.
 *
 * Refactored: CC reduced from 33 to ≤10 per function
 * (architecture-remediation T2.1, 2026-06-12).
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { generateNonce } from '../../../server/auth/nonce.js'
import { type ReservedRoutes, serveReservedRoute } from '../../../server/define/health-route.js'
import { sendError } from '../../../server/http/send-response.js'
import { buildSecurityHeaders } from '../../../server/security/security-headers.js'

import {
  tryServeAction,
  tryServeAgent,
  tryServeApiRoute,
  tryServeCustom404,
  tryServeStatic,
  type RequestHandlerCtx,
} from './handlers.js'
import {
  isSsrRenderResult,
  type SsrRender,
  type SsrRenderResult,
  type SsrRenderStreaming,
} from './ssr-setup.js'

export interface RequestHandlerContext {
  buildCtx: (
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
    startTime: number,
  ) => RequestHandlerCtx
  securityHeadersConfig: Parameters<typeof buildSecurityHeaders>[0]
  ssrRender: SsrRender | null
  ssrRenderStreaming: SsrRenderStreaming | null
  ssrStreamingEnabled: boolean
  htmlHead: string
  htmlTail: string
  indexHtml: string
  custom500Html: string | null
  /** M7-2: reserved health/ready routes served before the user catch-all. */
  reservedRoutes?: ReservedRoutes
}

/**
 * M7-2: serve a reserved `/__theo/*` route (health/ready) before any user
 * branch. Returns true when the request was handled.
 */
async function tryServeReserved(
  ctx: RequestHandlerContext,
  url: string,
  res: ServerResponse,
): Promise<boolean> {
  const pathname = new URL(url, 'http://localhost').pathname
  const reserved = await serveReservedRoute(pathname, ctx.reservedRoutes ?? {})
  if (reserved === null) return false
  const payload = JSON.stringify(reserved.body)
  res.writeHead(reserved.status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
  return true
}

function asSsrRenderResult(value: SsrRenderResult): SsrRenderResult {
  return value
}

function isRedirectResult(result: unknown): result is { redirect: Response } {
  return result !== null && typeof result === 'object' && 'redirect' in result
}

function sendRedirect(res: ServerResponse, result: { redirect: Response }): void {
  res.writeHead(302, { Location: result.redirect.headers.get('location') ?? '/' })
  res.end()
}

function send500(res: ServerResponse, custom500Html: string | null): void {
  if (!res.headersSent) {
    res.writeHead(500, { 'Content-Type': 'text/html' })
  }
  if (!res.writableEnded) {
    res.end(custom500Html ?? '<h1>500 — Server Error</h1>')
  }
}

function buildSsrHtml(
  ctx: RequestHandlerContext,
  result: string | SsrRenderResult,
  nonce: string,
): string {
  if (typeof result === 'string') {
    return ctx.htmlHead + result + ctx.htmlTail
  }
  if (isSsrRenderResult(result)) {
    const rendered = asSsrRenderResult(result)
    const dataJson = JSON.stringify(rendered.hydrationData).replace(/</g, '\\u003c')
    const hydrationScript = `<script${
      nonce ? ` nonce="${nonce}"` : ''
    }>window.__staticRouterHydrationData=${dataJson}</script>`
    return ctx.htmlHead + rendered.html + hydrationScript + ctx.htmlTail
  }
  return ctx.htmlHead + ctx.htmlTail
}

async function handleSsrStreaming(
  ctx: RequestHandlerContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  nonce: string,
): Promise<boolean> {
  if (!ctx.ssrStreamingEnabled || !ctx.ssrRenderStreaming) return false

  const controller = new AbortController()
  const onClose = (): void => {
    controller.abort()
  }
  req.on('close', onClose)
  try {
    const result = await ctx.ssrRenderStreaming(url, res, {
      signal: controller.signal,
      nonce,
    })
    if (isRedirectResult(result)) sendRedirect(res, result)
    return true
  } catch (streamErr) {
    console.error('[SSR Stream Error]', (streamErr as Error).message)
    send500(res, ctx.custom500Html)
    return true
  } finally {
    req.removeListener('close', onClose)
  }
}

async function handleSsrSync(
  ctx: RequestHandlerContext,
  res: ServerResponse,
  url: string,
  nonce: string,
): Promise<boolean> {
  if (!ctx.ssrRender) return false

  try {
    const result = await ctx.ssrRender(url, { nonce })
    if (isRedirectResult(result)) {
      sendRedirect(res, result)
      return true
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(buildSsrHtml(ctx, result, nonce))
    return true
  } catch (ssrErr) {
    console.error('[SSR Error] Falling back to CSR:', (ssrErr as Error).message)
    return false
  }
}

function handleFatalError(ctx: RequestHandlerContext, res: ServerResponse, err: unknown): void {
  if (ctx.custom500Html && !res.headersSent) {
    res.writeHead(500, { 'Content-Type': 'text/html' })
    res.end(ctx.custom500Html)
  } else if (!res.headersSent) {
    sendError(res, 'INTERNAL_ERROR', (err as Error).message, 500)
  } else {
    res.end()
  }
}

export function createRequestHandler(
  ctx: RequestHandlerContext,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = req.url ?? '/'
      const requestId = randomUUID()
      const start = Date.now()

      const nonce = generateNonce()
      const securityHeaders = buildSecurityHeaders(
        ctx.securityHeadersConfig,
        { production: true },
        { nonce },
      )
      for (const [k, v] of Object.entries(securityHeaders)) {
        res.setHeader(k, v)
      }

      const handlerCtx = ctx.buildCtx(req, res, requestId, start)

      try {
        if (await tryServeReserved(ctx, url, res)) return
        if (await tryServeAction(handlerCtx)) return
        if (await tryServeAgent(handlerCtx)) return
        if (await tryServeApiRoute(handlerCtx)) return
        if (tryServeStatic(handlerCtx)) return
        if (tryServeCustom404(handlerCtx)) return

        if (await handleSsrStreaming(ctx, req, res, url, nonce)) return
        if (await handleSsrSync(ctx, res, url, nonce)) return

        // CSR fallback
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(ctx.indexHtml)
      } catch (err) {
        handleFatalError(ctx, res, err)
      }
    })()
  }
}
