/**
 * RED tests for T2.1 — server/security/wildcard-origin.ts
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 2 / T2.1.
 * Port of Next.js csrf-protection.ts:6-94 wildcard matching.
 */
import { describe, expect, it } from 'vitest'

import {
  isCsrfOriginAllowed,
  matchWildcardDomain,
} from '../../packages/theo/src/server/security/wildcard-origin.js'

describe('matchWildcardDomain', () => {
  it('should match exact domain', () => {
    expect(matchWildcardDomain('example.com', 'example.com')).toBe(true)
  })

  it('should be DNS case-insensitive (RFC 1035)', () => {
    expect(matchWildcardDomain('Example.COM', 'example.com')).toBe(true)
    expect(matchWildcardDomain('example.com', 'EXAMPLE.COM')).toBe(true)
  })

  it('should match single-asterisk subdomain', () => {
    expect(matchWildcardDomain('app.example.com', '*.example.com')).toBe(true)
    expect(matchWildcardDomain('api.example.com', '*.example.com')).toBe(true)
  })

  it('should NOT match nested subdomain with single asterisk', () => {
    expect(matchWildcardDomain('deep.app.example.com', '*.example.com')).toBe(false)
  })

  it('should match arbitrary nesting with double asterisk', () => {
    expect(matchWildcardDomain('deep.app.example.com', '**.example.com')).toBe(true)
    expect(matchWildcardDomain('a.b.c.d.example.com', '**.example.com')).toBe(true)
  })

  it('should NOT match bare TLD pattern (*) alone', () => {
    expect(matchWildcardDomain('example.com', '*')).toBe(false)
    expect(matchWildcardDomain('example.com', '**')).toBe(false)
  })

  it('should NOT match different TLD', () => {
    expect(matchWildcardDomain('example.com', 'example.org')).toBe(false)
    expect(matchWildcardDomain('app.evil.com', '*.example.com')).toBe(false)
  })
})

describe('isCsrfOriginAllowed', () => {
  it('should allow exact-match origin from allowlist', () => {
    expect(isCsrfOriginAllowed('example.com', ['example.com'])).toBe(true)
  })

  it('should reject origin not in allowlist', () => {
    expect(isCsrfOriginAllowed('evil.com', ['example.com'])).toBe(false)
  })

  it('should allow wildcard-matched subdomain', () => {
    expect(isCsrfOriginAllowed('app.example.com', ['*.example.com'])).toBe(true)
  })

  it('should reject empty allowlist for non-empty origin', () => {
    expect(isCsrfOriginAllowed('example.com', [])).toBe(false)
  })

  it('should be case-insensitive', () => {
    expect(isCsrfOriginAllowed('Example.COM', ['example.com'])).toBe(true)
  })
})
