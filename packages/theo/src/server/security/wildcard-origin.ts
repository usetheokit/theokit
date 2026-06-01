/**
 * Wildcard origin matching for CSRF allowlist.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 2 / T2.1 + ADR D3.
 * Port of Next.js csrf-protection.ts:6-94 — DNS case-insensitive matching
 * with single (`*.example.com`) and double (`**.example.com`) asterisk
 * subdomain wildcards.
 *
 * Single asterisk matches exactly one subdomain segment; double asterisk
 * matches one or more (recursive). Bare `*` or `**` alone (no domain suffix)
 * are rejected as invalid patterns — prevents `*` matching everything.
 */

/**
 * Match a domain against a wildcard pattern. DNS-spec case-insensitive
 * (RFC 1035) via ASCII-only lowercasing (avoids Unicode quirks).
 */
export function matchWildcardDomain(domain: string, pattern: string): boolean {
  const normalizedDomain = domain.replace(/[A-Z]/g, (c) => c.toLowerCase())
  const normalizedPattern = pattern.replace(/[A-Z]/g, (c) => c.toLowerCase())

  const domainParts = normalizedDomain.split('.')
  const patternParts = normalizedPattern.split('.')

  if (patternParts.length < 1) return false
  if (domainParts.length < patternParts.length) return false

  // Reject bare `*` or `**` — must include at least one literal domain segment
  if (patternParts.length === 1) {
    const only = patternParts[0]
    if (only === '*' || only === '**') return false
  }

  while (patternParts.length > 0) {
    const patternPart = patternParts.pop()
    const domainPart = domainParts.pop()

    if (patternPart === '') return false // empty segment invalid
    if (patternPart === '*') {
      if (domainPart) continue
      return false
    }
    if (patternPart === '**') {
      // Must be the last (left-most) segment; remaining domain parts all match
      if (patternParts.length > 0) return false
      return domainPart !== undefined
    }
    if (domainPart !== patternPart) return false
  }

  return domainParts.length === 0
}

/**
 * Check whether `originDomain` is in `allowedOrigins`, with wildcard support.
 * Returns `true` if any allowlist entry matches.
 */
export function isCsrfOriginAllowed(
  originDomain: string,
  allowedOrigins: readonly string[] = [],
): boolean {
  const normalizedOrigin = originDomain.replace(/[A-Z]/g, (c) => c.toLowerCase())
  return allowedOrigins.some((allowed) => {
    if (!allowed) return false
    const normalizedAllowed = allowed.replace(/[A-Z]/g, (c) => c.toLowerCase())
    return normalizedAllowed === normalizedOrigin || matchWildcardDomain(originDomain, allowed)
  })
}
