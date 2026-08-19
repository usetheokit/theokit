/**
 * T2.2 (architecture-medium-deferrals plan, ADR D2) — SSR dev middleware
 * extracted from `vite-plugin/index.ts` for SRP.
 *
 * `setupSsrDevMiddleware(server, opts)` registers a Connect-style middleware
 * on the Vite dev server that:
 *   1. Skips API, static, and HMR requests (let other middlewares handle).
 *   2. Reads `index.html`, runs `transformIndexHtml`.
 *   3. Generates per-request nonce, applies security headers (CSP + Cache-Control).
 *   4. Calls `ssrLoadModule(VIRTUAL_ENTRY_SERVER_ID).render(url, { nonce })`.
 *   5. Injects rendered HTML (with hydration script) into root div.
 *   6. On error: ssrFixStacktrace + fallback to CSR via `next()`.
 *
 * No-op when `ssrEnabled === false`. Caller's responsibility to gate.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { ViteDevServer } from 'vite'

import { findRootDiv } from '../core/contracts/find-root-div.js'
import {
  applySecurityHeaders,
  generateNonce,
  type SecurityHeadersConfig,
} from '../server/internal-api.js'

import { hoistHeadTags } from './hoist-head-tags.js'

interface SsrRenderResult {
  html: string
  hydrationData: {
    loaderData?: unknown
    actionData?: unknown
    errors?: unknown
  }
}

interface SsrEntryServer {
  render: (
    url: string,
    opts: { nonce: string },
  ) => Promise<SsrRenderResult | { redirect: Response } | string>
}

/**
 * Stamps the request nonce onto every inline `<script>` the HTML already carries.
 *
 * `transformIndexHtml` lets Vite plugins inject their own scripts, and they know nothing about our
 * CSP. `@vitejs/plugin-react` injects its refresh preamble as an INLINE module script with no
 * nonce, so a nonce-based `script-src` blocks it, `window.$RefreshReg$` is never defined, and the
 * first component module throws "@vitejs/plugin-react can't detect preamble". SSR still produced
 * the HTML, so the page looks fine and simply never hydrates — nothing interactive works, and the
 * one console error points at Vite rather than at us (usetheokit/theokit#319).
 *
 * Only scripts WITHOUT `src` are stamped: a same-origin `src` is already covered by `'self'`, and
 * an inline script is the only kind a nonce is needed for. Scripts that already carry a nonce are
 * left alone, so the render's own output is never rewritten.
 *
 * Deliberately not a general HTML parser: this runs per request in dev, on markup we produced or a
 * Vite plugin injected, and the pattern only ever matches an opening `<script>` tag.
 */
export function applyNonceToInlineScripts(html: string, nonce: string): string {
  return html.replace(
    /<script(?![^>]*\ssrc=)(?![^>]*\snonce=)([^>]*)>/gi,
    `<script nonce="${nonce}"$1>`,
  )
}

function isSsrRenderResult(value: unknown): value is SsrRenderResult {
  if (typeof value !== 'object' || value === null) return false
  if (!('html' in value)) return false
  return typeof (value as Record<string, unknown>).html === 'string'
}

interface SsrDevMiddlewareOptions {
  projectRoot: string
  virtualEntryServerId: string
  securityHeaders: SecurityHeadersConfig | undefined
}

/**
 * Attach the SSR dev middleware to a Vite dev server. Caller decides whether
 * to invoke this based on `ssrEnabled` — this function does not gate.
 */
export function setupSsrDevMiddleware(server: ViteDevServer, opts: SsrDevMiddlewareOptions): void {
  server.middlewares.use((req, res, next) => {
    void (async () => {
      const url = req.url ?? '/'
      // Skip API, static, and HMR requests
      if (
        url.startsWith('/api/') ||
        url.startsWith('/@') ||
        url.startsWith('/node_modules/') ||
        url.includes('.')
      ) {
        next()
        return
      }

      try {
        const indexPath = resolve(opts.projectRoot, 'index.html')
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- projectRoot is from `theokit dev`'s caller-controlled cwd
        let template = readFileSync(indexPath, 'utf-8')

        // T4.1 — Generate a per-request nonce and apply security headers BEFORE render.
        // The same nonce flows into React's renderToPipeableStream({ nonce }) so every
        // emitted <script> carries it AND into the CSP script-src directive.
        // EC-3: applySecurityHeaders also forces Cache-Control: private, no-store.
        //
        // The nonce is minted BEFORE `transformIndexHtml` so the scripts Vite plugins inject can be
        // stamped with it. Minting it afterwards left the React refresh preamble unnonced, the CSP
        // blocked it, and the app never hydrated (usetheokit/theokit#319).
        const nonce = generateNonce()

        template = await server.transformIndexHtml(url, template)
        template = applyNonceToInlineScripts(template, nonce)
        applySecurityHeaders(
          res,
          opts.securityHeaders ?? {},
          { production: process.env.NODE_ENV === 'production' },
          { nonce },
        )

        const mod = (await server.ssrLoadModule(opts.virtualEntryServerId)) as SsrEntryServer
        const result = await mod.render(url, { nonce })

        if (result && typeof result === 'object' && 'redirect' in result) {
          res.writeHead(302, {
            Location: result.redirect.headers.get('location') ?? '/',
          })
          res.end()
          return
        }

        // Backward-compat: old render returned string. New shape returns
        // { html, hydrationData } so the framework can emit the hydration
        // data script OUTSIDE the React root (fixes hydration mismatch).
        let ssrHtml: string
        let hydrationScript = ''
        if (typeof result === 'string') {
          ssrHtml = result
        } else if (isSsrRenderResult(result)) {
          ssrHtml = result.html
          const dataJson = JSON.stringify(result.hydrationData).replace(/</g, '\\u003c')
          hydrationScript = `<script nonce="${nonce}">window.__staticRouterHydrationData=${dataJson}</script>`
        } else {
          ssrHtml = ''
        }
        // Move the route's <title>/<meta>/<link> out of the rendered body and into the head.
        // React only hoists those in the browser, after hydration — a crawler that does not run JS
        // would otherwise never see a page's own title or social card (usetheokit/theokit#319).
        const hoisted = hoistHeadTags(template, ssrHtml)
        template = hoisted.template
        ssrHtml = hoisted.html

        const rootDiv = findRootDiv(template)
        if (!rootDiv) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(template)
          return
        }

        const splitIdx = rootDiv.insertAt
        const html =
          template.slice(0, splitIdx) + ssrHtml + hydrationScript + template.slice(splitIdx)

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      } catch (err) {
        server.ssrFixStacktrace(err as Error)
        console.error('[SSR Dev Error]', err)
        // Fallback to CSR
        next()
        return
      }
    })()
  })
}
