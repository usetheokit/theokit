import type { IncomingMessage } from 'node:http'

/**
 * Resolves the address a rate-limit bucket should be keyed on.
 *
 * ## Why this is not just `req.socket.remoteAddress`
 *
 * Behind any reverse proxy — Caddy, nginx, a load balancer, an ingress controller — the socket
 * address is the PROXY's, identical for every visitor on the internet. Keying buckets on it gives
 * the whole world one shared budget, so the first few requests each minute exhaust it and everyone
 * else is refused. That is worse than no limiting: a limit meant to stop one abusive client becomes
 * a denial of service any single client can trigger for everybody.
 *
 * ## Why it is opt-in
 *
 * `x-forwarded-for` is a request header, and a request header is whatever the client typed. Reading
 * it without being told to would let anyone bypass the limiter by rotating a forged value — a
 * one-line `curl -H`. So the default is to trust nothing and use the socket.
 *
 * ## Why the RIGHTMOST entry
 *
 * Each proxy APPENDS the address that connected to it. A client that sends `x-forwarded-for: 1.2.3.4`
 * through one proxy produces `1.2.3.4, <real client>` — the forgery lands on the left, and the entry
 * the trusted proxy wrote is last. Counting from the right therefore skips exactly the hops the
 * operator vouched for, and everything a client can influence stays to the left of where we look.
 *
 * This mirrors the `'trusted-proxy'` policy in `adapters/web-shim.ts`, which documents the same rule
 * for the Web-Request runtimes.
 */

/**
 * How many proxies sit in front of the app.
 *
 * `false` (the default) trusts nothing and uses the socket address. `true` means one trusted proxy.
 * A number names the hop count for a longer chain — a CDN in front of your own proxy is `2`.
 */
export type TrustProxy = boolean | number

/** `true` is shorthand for a single proxy; `false` for none. A number passes through. */
function hopCount(trustProxy: TrustProxy): number {
  if (trustProxy === true) return 1
  if (trustProxy === false) return 0
  return trustProxy
}

/** Reads a header that Node may hand back as an array. */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name]
  if (Array.isArray(raw)) return raw[raw.length - 1]
  return raw
}

/**
 * The forwarded-header half of the decision, with no runtime in it.
 *
 * Extracted (usetheokit/theokit#612) so the Node path and the Web path cannot drift: a `Request`
 * has the same headers and no socket, and the arithmetic on those headers is the part that is easy
 * to get subtly wrong twice. What the two runtimes genuinely disagree about — where the fallback
 * address comes from — stays with each caller.
 *
 * @param header the raw `x-forwarded-for` value, if present
 * @param realIpHeader the raw `x-real-ip` value, if present
 * @param trustProxy how many proxies the operator vouched for
 * @returns the address to key on, or `undefined` when no trusted entry could be read
 *
 * Module-private: the two exported resolvers below are the whole surface, and a caller holding
 * the raw header arithmetic would be re-deciding the part that is easy to get wrong.
 */
function addressFromForwardedHeaders(
  header: string | undefined,
  realIpHeader: string | undefined,
  trustProxy: TrustProxy,
): string | undefined {
  const hops = hopCount(trustProxy)
  if (hops < 1) return undefined

  if (header) {
    const entries = header
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

    // Count in from the right by the number of hops the operator vouched for. A chain shorter than
    // configured means a request did NOT come through the expected proxies — a direct hit on the
    // app's port, say — so we report nothing rather than reading an entry the client could have
    // written.
    const index = entries.length - hops
    if (index >= 0 && index < entries.length) return entries[index]
  }

  // `x-real-ip` carries a single address and is written by the proxy, not appended to, so there is
  // no hop arithmetic to do. Only consulted when a proxy is trusted at all.
  const realIp = realIpHeader?.trim()
  return realIp === undefined || realIp === '' ? undefined : realIp
}

export function resolveClientIp(req: IncomingMessage, trustProxy: TrustProxy = false): string {
  // `req.socket` is typed as always-present in Node typings; the optional chain keeps the fallback
  // reachable for test doubles built as plain object literals.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive for test doubles
  const socketAddress = req.socket?.remoteAddress ?? 'unknown'

  return (
    addressFromForwardedHeaders(
      headerValue(req, 'x-forwarded-for'),
      headerValue(req, 'x-real-ip'),
      trustProxy,
    ) ?? socketAddress
  )
}

/**
 * The Web-`Request` twin of {@link resolveClientIp}.
 *
 * There is no socket to fall back to, so the answer is `undefined` when no trusted proxy wrote an
 * address. A caller MUST treat that as "cannot identify" rather than substituting a constant:
 * bucketing every visitor under one placeholder turns a rate limiter into a shared budget the first
 * caller each window exhausts for the whole internet.
 */
export function resolveClientIpFromRequest(
  request: Request,
  trustProxy: TrustProxy = false,
): string | undefined {
  return addressFromForwardedHeaders(
    request.headers.get('x-forwarded-for') ?? undefined,
    request.headers.get('x-real-ip') ?? undefined,
    trustProxy,
  )
}
