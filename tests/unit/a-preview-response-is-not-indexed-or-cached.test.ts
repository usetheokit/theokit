import { describe, expect, it } from 'vitest'

import {
  buildSecurityHeaders,
  type SecurityEnv,
  type SecurityHeadersConfig,
} from '../../packages/theo/src/server/security/security-headers.js'

/**
 * A response served against a preview credential is not indexed, and not cached where others can
 * reach it (B-034).
 *
 * `docs/surfaces/draft-preview.md` measured the absence on 2026-08-20: `noindex` and `robots`
 * returned zero hits across both source trees. The credential half is `preview/preview-marker.ts`;
 * this is the response half, and the two together are what the item's first Definition-of-done
 * bullet asks for — *"an unpublished document is served only against a valid preview credential,
 * with `noindex` on that response"*.
 *
 * ## Why `Cache-Control` is here and not treated as a bonus
 *
 * A draft cached by a CDN is served to everyone who asks, credential or not. Without `private,
 * no-store` the first clause of that Definition-of-done — *served ONLY against a valid credential* —
 * is false however good the credential is. The header is not gold-plating; it is the clause.
 *
 * ## Why this is not the nonce's `no-store`
 *
 * `buildSecurityHeaders` already emits `private, no-store` when a nonce is in play, for a different
 * reason (EC-3: a cached HTML body carrying one nonce re-served against a freshly-minted CSP header)
 * — and that path is deliberately EXEMPT for prerendered routes, whose HTML is meant to be cached.
 * The preview reason does not take that exemption: a prerendered draft is still a draft. The last
 * test below is the one that would go red if someone folded the two conditions together.
 */

const config: SecurityHeadersConfig = { cspMode: 'enforce' }
const env: SecurityEnv = { production: true }

describe('a response served against a preview credential', () => {
  it('test_an_ordinary_response_carries_NO_robots_directive', () => {
    // COUNTERPROOF. A header emitted unconditionally would make every assertion below pass while
    // telling search engines to drop the whole site.
    expect(buildSecurityHeaders(config, env)['X-Robots-Tag']).toBeUndefined()
  })

  it('test_a_preview_response_is_noindex', () => {
    expect(buildSecurityHeaders(config, env, { preview: true })['X-Robots-Tag']).toBe(
      'noindex, nofollow',
    )
  })

  it('test_a_preview_response_is_not_publicly_cacheable', () => {
    expect(buildSecurityHeaders(config, env, { preview: true })['Cache-Control']).toBe(
      'private, no-store',
    )
  })

  it('test_a_PRERENDERED_preview_is_still_not_indexed_or_cached', () => {
    // The nonce path exempts prerendered routes because their HTML is meant to be cached. A draft is
    // not, and folding the two conditions into one would silently take that exemption.
    const headers = buildSecurityHeaders(config, env, { preview: true, prerender: true })
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow')
    expect(headers['Cache-Control']).toBe('private, no-store')
  })
})
