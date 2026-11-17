/**
 * T7.4 — OpenID Connect Discovery 1.0 metadata fetcher.
 *
 * Reference: https://openid.net/specs/openid-connect-discovery-1_0.html
 *
 * Caches metadata in module scope. Cache key is the exact issuer string
 * (trailing-slash sensitive per RFC 8414 §3). Failures are NOT cached —
 * subsequent calls retry the fetch.
 *
 * EC-7 — HTTPS enforced. RFC 8414 §3 requires HTTPS for OIDC issuers.
 * Localhost (loopback) is allowed for development.
 */

export interface OidcMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri?: string
  userinfo_endpoint?: string
  end_session_endpoint?: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  grant_types_supported?: string[]
  id_token_signing_alg_values_supported?: string[]
  [key: string]: unknown // OIDC providers ship many optional fields
}

const cache = new Map<string, Promise<OidcMetadata>>()

/** Clear the discovery cache. Used by tests. */
export function clearOidcCache(): void {
  cache.clear()
}

/** Thrown when the issuer or a discovered endpoint is neither https nor loopback. */
export class OidcInsecureEndpointError extends Error {
  readonly name = 'OidcInsecureEndpointError'
  readonly code = 'oidc_insecure_endpoint'
  /** 'issuer' or the metadata field name, e.g. 'token_endpoint' */
  readonly field: string
  readonly url: string

  constructor(field: string, url: string, detail?: string) {
    super(
      detail ??
        `OIDC ${field} must use HTTPS (received "${url}"). ` +
          `Plain HTTP is allowed only for loopback hosts.`,
    )
    this.field = field
    this.url = url
  }
}

function isLoopback(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '[::1]' ||
    host === '::1' ||
    // 127.0.0.0/8. Never 0.0.0.0: a bind address, not a loopback destination.
    /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/.test(host)
  )
}

/** https always; http only for localhost, [::1], ::1 and 127.0.0.0/8. Never 0.0.0.0. */
export function isSafeOidcUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'https:') return true
  return parsed.protocol === 'http:' && isLoopback(parsed.hostname)
}

const REQUIRED_ENDPOINTS = ['authorization_endpoint', 'token_endpoint'] as const
const OPTIONAL_ENDPOINTS = ['userinfo_endpoint', 'jwks_uri', 'end_session_endpoint'] as const

function assertSafeEndpoints(metadata: OidcMetadata): void {
  for (const field of [...REQUIRED_ENDPOINTS, ...OPTIONAL_ENDPOINTS]) {
    const value = metadata[field]
    if (value === undefined || value === null) {
      if ((REQUIRED_ENDPOINTS as readonly string[]).includes(field)) {
        throw new Error(`OIDC metadata missing ${field} — provider response is invalid`)
      }
      continue
    }
    if (typeof value !== 'string' || !isSafeOidcUrl(value)) {
      throw new OidcInsecureEndpointError(field, String(value))
    }
  }
}

/**
 * Fetch (or return cached) OIDC provider metadata.
 *
 * Throws when:
 *   - Issuer URL is malformed
 *   - Issuer is HTTP and not a loopback host (EC-7): OidcInsecureEndpointError, field 'issuer'
 *   - HTTP response is non-OK
 *   - Metadata lacks `authorization_endpoint` (sanity check)
 *   - Any returned endpoint (`authorization_endpoint`, `token_endpoint`, and when present
 *     `userinfo_endpoint`, `jwks_uri`, `end_session_endpoint`) is not https or loopback:
 *     OidcInsecureEndpointError with the field name. Every endpoint this function returns is
 *     https or loopback. Endpoints need not share the issuer's host.
 */
export async function discoverOidcProvider(issuer: string | URL): Promise<OidcMetadata> {
  const issuerStr = typeof issuer === 'string' ? issuer : issuer.toString()
  // Validate protocol BEFORE checking cache — invalid issuers should never poison.
  const url = new URL(issuerStr)
  if (!isSafeOidcUrl(issuerStr)) {
    throw new OidcInsecureEndpointError(
      'issuer',
      issuerStr,
      `OIDC issuer must use HTTPS (received "${url.protocol}//${url.hostname}…"). ` +
        `RFC 8414 §3 forbids plain HTTP except for loopback hosts.`,
    )
  }

  const cached = cache.get(issuerStr)
  if (cached) return cached

  const promise = (async () => {
    const wellKnown = new URL(
      '.well-known/openid-configuration',
      issuerStr.endsWith('/') ? issuerStr : issuerStr + '/',
    )
    const res = await fetch(wellKnown)
    if (!res.ok) {
      throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText} at ${wellKnown}`)
    }
    const metadata = (await res.json()) as OidcMetadata
    if (!metadata.authorization_endpoint) {
      throw new Error('OIDC metadata missing authorization_endpoint — provider response is invalid')
    }
    assertSafeEndpoints(metadata)
    return metadata
  })()
  // Cache the promise; on rejection, remove so the next call retries.
  cache.set(issuerStr, promise)
  promise.catch(() => {
    if (cache.get(issuerStr) === promise) cache.delete(issuerStr)
  })
  return promise
}
