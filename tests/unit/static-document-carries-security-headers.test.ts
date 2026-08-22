/**
 * The HTML document is served by the platform, so the platform has to be told the baseline
 * (usetheokit/theokit#412).
 *
 * The six Web adapters apply the configured security headers to every response their handler
 * returns — and on four targets that handler never returns the document: it answers `/api/*` and
 * 404s everything else, while the page comes from the platform's static host. So the JSON was
 * protected and the page it renders in was not, which is the wrong half of a clickjacking or
 * MIME-sniffing defence.
 *
 * Two of them read a config file THIS BUILD ALREADY EMITS, so they can be told. The others own no
 * artifact here and are documented instead — see the issue.
 *
 * ## What these tests prove, and what they cannot
 *
 * They prove the emitted configuration carries the baseline, and that it is the SAME baseline the
 * handler applies — derived from `buildSecurityHeaders` rather than transcribed, so the document
 * and the API cannot disagree.
 *
 * They do NOT prove a deployed page carries the headers: that needs a deployment, and neither
 * platform is deployed from CI. Saying so is the point — B-026's standard was a real response with
 * the headers on it, and emitting config that "looks right" while claiming the target is protected
 * is the failure that standard exists to prevent.
 */
import { describe, expect, it } from 'vitest'

import { mergeNetlifyToml } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelConfigJson } from '../../packages/theo/src/adapters/vercel.js'
import { buildSecurityHeaders } from '../../packages/theo/src/server/security/security-headers.js'

const BASELINE = buildSecurityHeaders({}, { production: true })

describe('vercel tells its static host the baseline (#412)', () => {
  it('emits a header rule for every path', () => {
    const rules = renderVercelConfigJson({}).routes

    const headerRule = rules.find((r) => r.headers !== undefined)
    expect(headerRule, 'no route rule carries headers').toBeDefined()
    expect(headerRule?.src).toBe('/(.*)')
  })

  it('lets routing continue, so the rule adds headers instead of answering', () => {
    // Without `continue`, a matching rule TERMINATES routing in Build Output v3 — every request
    // would get the headers and no content.
    const headerRule = renderVercelConfigJson({}).routes.find((r) => r.headers !== undefined)

    expect(headerRule?.continue).toBe(true)
  })

  it('places it before the filesystem handler, or it never runs for a static file', () => {
    const rules = renderVercelConfigJson({})
    const headerAt = rules.routes.findIndex((r) => r.headers !== undefined)
    const filesystemAt = rules.routes.findIndex((r) => r.handle === 'filesystem')

    expect(headerAt).toBeGreaterThanOrEqual(0)
    expect(headerAt).toBeLessThan(filesystemAt)
  })

  it('carries the same values the handler applies, derived rather than transcribed', () => {
    const headerRule = renderVercelConfigJson({}).routes.find((r) => r.headers !== undefined)

    expect(headerRule?.headers).toEqual(BASELINE)
  })

  it('honours a configured value, not only the defaults', () => {
    const rules = renderVercelConfigJson({ frameOptions: 'SAMEORIGIN' })
    const headerRule = rules.routes.find((r) => r.headers !== undefined)

    expect(headerRule?.headers?.['X-Frame-Options']).toBe('SAMEORIGIN')
  })
})

describe('netlify tells its static host the baseline (#412)', () => {
  it('emits a headers block for every path', () => {
    const toml = mergeNetlifyToml(null, {})

    expect(toml).toContain('[[headers]]')
    expect(toml).toMatch(/for\s*=\s*"\/\*"/u)
  })

  it('carries the same values the handler applies', () => {
    const toml = mergeNetlifyToml(null, {})

    for (const [key, value] of Object.entries(BASELINE)) {
      expect(toml, `${key} missing from netlify.toml`).toContain(`${key} = "${value}"`)
    }
  })

  it('is idempotent — a second merge does not append a duplicate block', () => {
    const once = mergeNetlifyToml(null, {})
    const twice = mergeNetlifyToml(once, {})

    expect(twice.match(/\[\[headers\]\]/gu)?.length).toBe(1)
  })

  it("leaves a user's own headers block alone", () => {
    // Their file, their rules. Appending ours beside theirs is additive; rewriting theirs is not
    // ours to do, and Netlify applies both.
    const existing = [
      '[[headers]]',
      '  for = "/assets/*"',
      '  [headers.values]',
      '    Cache-Control = "max-age=31536000"',
    ].join('\n')

    const merged = mergeNetlifyToml(existing, {})

    expect(merged).toContain('for = "/assets/*"')
    expect(merged).toContain('Cache-Control = "max-age=31536000"')
    expect(merged).toMatch(/for\s*=\s*"\/\*"/u)
  })

  it('still merges the redirect it always did', () => {
    const toml = mergeNetlifyToml(null, {})

    expect(toml).toContain('[[redirects]]')
    expect(toml).toContain('to = "/.netlify/functions/theo"')
  })
})
