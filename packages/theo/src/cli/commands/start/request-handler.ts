/**
 * Inline request handler for `theokit start` (T4.2 architecture-cleanup).
 *
 * Wires the per-request flow: security headers → action/route/static branches
 * → SSR fallback → CSR fallback → 500 page.
 *
 * Refactored: CC reduced from 33 to ≤10 per function
 * (architecture-remediation T2.1, 2026-06-12).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { generateNonce } from '../../../server/auth/nonce.js'
import { type ReservedRoutes, serveReservedRoute } from '../../../server/define/health-route.js'
import type { CorsHandler } from '../../../server/http/cors.js'
import { sendError } from '../../../server/http/send-response.js'
import { TRACE_HEADER, extractTraceId } from '../../../server/http/trace-context.js'
import { buildSecurityHeaders } from '../../../server/security/security-headers.js'
import { extractHeadTags, injectIntoHead } from '../../../vite-plugin/hoist-head-tags.js'
import { applyNonceToInlineScripts } from '../../../vite-plugin/ssr-dev-middleware.js'

import {
  tryServeAction,
  tryServeAgent,
  tryServeAgentAux,
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

interface RequestHandlerContext {
  buildCtx: (
    req: IncomingMessage,
    res: ServerResponse,
    requestId: string,
    startTime: number,
  ) => RequestHandlerCtx
  securityHeadersConfig: Parameters<typeof buildSecurityHeaders>[0]
  /**
   * #409 — `security.cors` had exactly one consumer, Vite's `configureServer` hook, so an app that
   * worked cross-origin under `theokit dev` stopped working the moment this command served it:
   * same config, same code, no error and no warning. `null` when the app declared no `cors` block,
   * which is what it meant before and still means — no headers, not permissive ones.
   */
  corsHandler: CorsHandler | null
  ssrRender: SsrRender | null
  ssrRenderStreaming: SsrRenderStreaming | null
  ssrStreamingEnabled: boolean
  htmlHead: string
  htmlTail: string
  /**
   * B-035 — the route-to-chunks relation `theokit build` emits, read ONCE at startup and never
   * per request: it is a build artifact and cannot change while the server runs. Absent when the
   * build predates the map, which serves without preloads rather than failing the request.
   */
  assetsMap?: Record<string, string[]>
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

/**
 * Moves the route's `<title>`/`<meta>`/`<link>` from the rendered body into the head.
 *
 * `ctx.htmlHead` is the template up to and including `<div id="root">`, so it still contains the
 * `</head>` this injects before. Without it, a route's metadata ships inside the body and only
 * reaches the head after hydration — which never happens for a crawler that does not run
 * JavaScript, and those are exactly the ones that render social cards.
 *
 * The dev middleware does the same thing; both paths have to, or previews work in one and not the
 * other, which is worse than neither.
 */
export function withHoistedHead(
  htmlHead: string,
  ssrHtml: string,
  nonce: string,
): { head: string; body: string } {
  const { html, headTags } = extractHeadTags(ssrHtml)

  // The nonce is stamped onto the template's own inline scripts here, per request, because the
  // nonce differs per request while `ctx.htmlHead` is computed once at startup. Without it, a CSP
  // with a nonce blocks anything the template inlines — including the theme-init script that
  // applications put in `<head>` specifically to avoid a flash of the wrong theme on load.
  const head = applyNonceToInlineScripts(injectIntoHead(htmlHead, headTags), nonce)
  return { head, body: html }
}

/**
 * Render one `<link rel="modulepreload">` per chunk the route needs beyond the entry, and
 * inject them before `</head>`.
 *
 * In the HEAD, not the body: a preload the browser meets after parsing the entry teaches it
 * nothing it was not about to learn, which is the whole defect. `extractHeadTags` hoists what
 * React rendered; these are not rendered by React at all, so they are injected here.
 *
 * The chunk name is a build output and not user input, and it is escaped anyway: the cost is a
 * regex and the alternative is trusting that no file name will ever contain a quote.
 */
export function injectModulePreloads(
  head: string,
  // `string[] | undefined` on the VALUE is deliberate, and it is the second time this change
  // needed it: an index lookup can miss, so the guard below is a runtime check. A type that
  // could not miss makes a type-based lint call that guard redundant, and obeying the lint
  // would turn a handled case — a route absent from the map — into a crash per request.
  assetsMap: Record<string, string[] | undefined> | undefined,
  url: string,
): string {
  if (assetsMap === undefined) return head
  // The map is keyed by route path; a request carries a query string and may carry a trailing
  // slash, neither of which changes which route is being served.
  const path = url.split(/[?#]/)[0] ?? url
  const route = path.length > 1 ? path.replace(/\/$/, '') : path
  const chunks = assetsMap[route] ?? assetsMap[path]
  if (chunks === undefined || chunks.length === 0) return head
  const links = chunks
    .map((chunk) => `<link rel="modulepreload" href="/${escapeAttribute(chunk)}">`)
    .join('')
  const closing = /<\/head\s*>/i
  return closing.test(head) ? head.replace(closing, (tag) => links + tag) : head + links
}

/** Attribute-safe: a chunk name must not be able to close the attribute it sits in. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function buildSsrHtml(
  ctx: RequestHandlerContext,
  result: string | SsrRenderResult,
  nonce: string,
  url: string,
): string {
  if (typeof result === 'string') {
    const { head, body } = withHoistedHead(ctx.htmlHead, result, nonce)
    return injectModulePreloads(head, ctx.assetsMap, url) + body + ctx.htmlTail
  }
  if (isSsrRenderResult(result)) {
    const rendered = asSsrRenderResult(result)
    const dataJson = JSON.stringify(rendered.hydrationData).replace(/</g, '\\u003c')
    const hydrationScript = `<script${
      nonce ? ` nonce="${nonce}"` : ''
    }>window.__staticRouterHydrationData=${dataJson}</script>`
    const { head, body } = withHoistedHead(ctx.htmlHead, rendered.html, nonce)
    return injectModulePreloads(head, ctx.assetsMap, url) + body + hydrationScript + ctx.htmlTail
  }
  return applyNonceToInlineScripts(ctx.htmlHead, nonce) + ctx.htmlTail
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
      // #343 — the streamed response carried neither of these, so `ssrStreaming: true`
      // served a bare React tree: no `<head>`, no client entry, no hydration data.
      //
      // `applyNonceToInlineScripts` and not `withHoistedHead`: hoisting reads the
      // RENDERED body for head elements, and nothing is rendered yet when the head
      // has to flush. Metadata hoisting under streaming is the same defect on a
      // different surface, and it is M9's, not this one's.
      htmlHead: applyNonceToInlineScripts(ctx.htmlHead, nonce),
      htmlTail: ctx.htmlTail,
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
    res.end(buildSsrHtml(ctx, result, nonce, url))
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
      // #353 — production minted a fresh UUID on every request and discarded the
      // incoming W3C `traceparent`, so a trace crossing into this server started
      // over and no span could continue it. `theo dev` has honoured the header on
      // `/api/*` since Phase 7 (`vite-plugin/api-middleware.ts:368`); this is the
      // same resolution on the path a deploy actually serves.
      //
      // The tier-2 fallback (`x-request-id`) is caller-controlled and validated
      // inside `extractTraceId` before it is trusted — it ends up in the logs.
      const requestId = extractTraceId(req)
      const start = Date.now()
      // Echoed under both names, matching dev: `x-request-id` is what existing
      // consumers read, `x-trace-id` is the canonical one.
      res.setHeader('x-request-id', requestId)
      res.setHeader(TRACE_HEADER, requestId)

      // Preflight before anything else, and it answers rather than routing — the same order the
      // dev middleware uses (`vite-plugin/api-middleware.ts`), because an OPTIONS the router
      // handles is an OPTIONS the browser never gets a CORS answer to.
      if (ctx.corsHandler?.handlePreflight(req, res) === true) return
      ctx.corsHandler?.applyHeaders(req, res)

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
        if (await tryServeAgentAux(handlerCtx)) return
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
