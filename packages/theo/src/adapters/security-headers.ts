/**
 * The security headers a deployed target puts on its responses.
 *
 * `theokit start` applies the configured baseline to every response it writes
 * (`cli/commands/start/request-handler.ts`). None of the six Web-standards
 * deploy adapters applied any, so the same page carried a CSP,
 * `X-Frame-Options`, HSTS and `nosniff` under `theokit start` and none of them
 * once deployed (usetheokit/theokit#410, GHSA-87qq-fgcr-384x).
 *
 * This module is the seam that closes that half of the gap. It has two halves
 * and they live together on purpose: the code that writes the literal into a
 * generated entry and the code that reads it at request time have to agree on
 * one shape, and a shape stated in two files drifts.
 *
 * - **Build time** — {@link renderSecurityHeadersConfigLiteral} turns
 *   `security.headers` into a JSON literal the adapter inlines. A deployed
 *   runtime has no `theo.config.ts` to read, so the configuration travels as
 *   data.
 * - **Request time** — the generated entry calls {@link buildSecurityHeaders}
 *   on that literal and hands every response to {@link withSecurityHeaders}.
 *   The same function `theokit start` calls, on the same input, so the two
 *   cannot disagree about what the configuration means.
 *
 * ## The per-request nonce, and where it stops
 *
 * `buildSecurityHeaders` accepts a per-request `nonce` and substitutes it into
 * `script-src`. A nonce cannot survive a build-time literal — it is minted per
 * response — so a target reaches one only if it renders the HTML at request
 * time and can put the same value on the script tags it emits.
 *
 * Exactly one deploy path does: **Cloudflare with `ssrStreaming: true`**, whose
 * worker calls `renderStreamingWeb(request, { nonce })`, and that renderer
 * threads the value into `renderToReadableStream` and into the hydration script
 * (`router/entry-server.ts`). That branch mints a nonce per request and builds
 * its CSP from it. Everything else serves HTML written at build time, or no
 * HTML at all, and carries a **nonce-less CSP** — the same answer
 * `buildSecurityHeaders` already gives a prerendered route (EC-4), for the same
 * reason: a nonce in the header with no nonce on the tag blocks every inline
 * script.
 *
 * That asymmetry is real and is not smoothed over. It is stated in the emitted
 * entry, printed by the build through
 * {@link describeDeployedSecurityHeaders}, and written down in
 * `docs/surfaces/build-adapters.md`.
 */
import { generateNonce } from '../core/contracts/nonce.js'
import type { SecurityHeadersConfig } from '../core/contracts/security-headers.js'
import { buildSecurityHeaders } from '../core/contracts/security-headers.js'

/**
 * Re-exported so a generated entry has ONE import for the whole concern.
 *
 * Reaching it through `theokit/server/security` would work and would also drag
 * that barrel's CSRF surface into a Worker bundle, for a function that is forty
 * lines of string concatenation. It is defined in `core/contracts/`, which is
 * the module every target may import from — `adapters → server` is not an edge
 * in the DAG, and the header policy was never server code.
 */
export { buildSecurityHeaders }

/**
 * Re-exported for the same reason, and so the streamed Cloudflare worker mints
 * its nonce with the identical primitive `theokit start` uses
 * (`cli/commands/start/request-handler.ts`) rather than a second, hand-rolled
 * one. It is already runtime-portable: Web Crypto first, with a named error
 * when the runtime has none.
 */
export { generateNonce }

/**
 * The `security.headers` block, as a literal a generated entry can carry.
 *
 * `{}` when the app declares none — which is not the same as "no headers".
 * `buildSecurityHeaders({})` returns the full default baseline, and `{}` is
 * exactly what `theokit start` passes when `security.headers` is absent
 * (`cli/commands/start/index.ts`). An app with no security block gets the same
 * baseline deployed as it gets locally.
 */
export function renderSecurityHeadersConfigLiteral(
  headers: SecurityHeadersConfig | undefined,
): string {
  return JSON.stringify(headers ?? {})
}

/**
 * Put the headers on a response, without overruling the handler.
 *
 * `theokit start` sets the baseline BEFORE the route handler runs, so a handler
 * can override it with `res.setHeader` (last write wins, Node convention). On a
 * Web target the response arrives already built, so the equivalent of "the
 * handler wins" is to skip a header the response already carries: a route that
 * set its own `Content-Security-Policy` keeps it.
 *
 * Mutates and returns the same `Response` rather than constructing a
 * replacement, because these responses are handed to the runtime while their
 * body is still being written (#382) and re-wrapping the stream is exactly the
 * second buffering point that change removed.
 *
 * Mutation is safe for every response these entries produce: the Fetch spec
 * gives a locally constructed `Response` the `response` header guard, which
 * permits `set` for every name used here. The `immutable` guard belongs to
 * responses that came back from `fetch()`, and none of the six emitted handlers
 * returns one — each builds its response from `createWebShim`, from a `new
 * Response(...)`, or from the SSR renderer. The WebSocket upgrade, which is the
 * one response an adapter gets from its runtime rather than building, is
 * deliberately not routed through here.
 */
export function withSecurityHeaders(response: Response, headers: Record<string, string>): Response {
  for (const [key, value] of Object.entries(headers)) {
    if (!response.headers.has(key)) response.headers.set(key, value)
  }
  return response
}

export interface DeployedSecurityHeaderLimits {
  target: string
  /** The app's `security.headers` block, or undefined when it declares none. */
  securityHeaders: SecurityHeadersConfig | undefined
  /**
   * Does the emitted handler render HTML at request time and mint a CSP nonce
   * for it? True only for Cloudflare with `ssrStreaming: true`.
   */
  mintsNonce: boolean
  /**
   * Is the HTML document served by a platform static host rather than by the
   * handler this build emits? True wherever the emitted handler answers
   * `/api/*` and returns 404 for everything else.
   */
  /**
   * Who puts the security headers on the HTML DOCUMENT — a different question from who serves it,
   * and the two used to be collapsed into one boolean (usetheokit/theokit#412).
   *
   * - `handler` — this target's own handler returns the document, so it carries the same baseline
   *   every API response carries. No caveat.
   * - `platform-configured` — the platform's static host serves the document, AND this build emits
   *   the configuration that puts the headers on it (`.vercel/output/config.json`, `netlify.toml`).
   *   Still worth stating, because nothing here has seen a deployed response.
   * - `platform-unmanaged` — the platform serves it and this build owns no artifact that could
   *   configure it. This is the real remaining gap, and it stays named.
   *
   * The two-value version reported `platform-configured` targets with the same message as
   * `platform-unmanaged` ones, telling an operator to go and do work the build had already done —
   * and a stale limitation reads exactly like a current one.
   */
  documentHeaders: 'handler' | 'platform-configured' | 'platform-unmanaged'
}

/**
 * What the build tells the operator, once, per target.
 *
 * Silent degradation is the failure mode `rules/three-target-parity.md` exists
 * to prevent. Two things degrade quietly here and both are named rather than
 * discovered in production: a CSP that refuses inline scripts on a deploy while
 * allowing them locally, and an HTML document that never passes through the
 * handler these headers are attached to.
 *
 * The header names are read from the map the entry will actually carry, not
 * from a list written next to it. A configuration that switches HSTS or the CSP
 * off would otherwise be announced as sending them.
 */
export function describeDeployedSecurityHeaders(limits: DeployedSecurityHeaderLimits): string {
  const headers = buildSecurityHeaders(limits.securityHeaders ?? {}, { production: true })
  const names = Object.keys(headers)
  if (names.length === 0) {
    return `  ! \`${limits.target}\` sends no security headers: the configuration switched every one of them off.`
  }

  const lines = [
    `  ✓ security headers on every response \`${limits.target}\` returns: ${names.join(', ')}.`,
  ]
  const sendsCsp = names.some((name) => name.startsWith('Content-Security-Policy'))
  if (sendsCsp && !limits.mintsNonce) {
    lines.push(
      `    - The CSP carries no nonce: this target serves HTML written at build time,`,
      `      so there is no per-request value to put on a script tag. An inline`,
      `      <script> is refused by \`script-src 'self'\` here, while the same page`,
      `      under \`theokit start\` gets a nonce and runs it. Move inline scripts to`,
      `      \`<script src="...">\`, or set \`security.headers.cspMode: 'report-only'\``,
      `      while you migrate.`,
    )
  }
  if (limits.documentHeaders === 'platform-configured') {
    lines.push(
      `    - The HTML document is served by the platform's static host, and reaches`,
      `      the browser with these headers through config this build emits. That`,
      `      path is not verified by a deploy from here — the values come from the`,
      `      same function the handler uses, but no response has been read back.`,
    )
  }
  if (limits.documentHeaders === 'platform-unmanaged') {
    lines.push(
      `    - The HTML document does NOT pass through this handler — the platform's`,
      `      static host serves it — so these headers reach \`/api/*\` responses and`,
      `      not the page. This build emits no artifact that could configure it, so`,
      `      set the document's headers on the platform (usetheokit/theokit#412).`,
    )
  }
  return lines.join('\n')
}
