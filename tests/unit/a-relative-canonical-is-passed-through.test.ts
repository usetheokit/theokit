import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Metadata } from '../../packages/theo/src/client/metadata.js'

/**
 * B-243. `refuseRelativeOgImage` throws in development on a relative `ogImage`, and `canonical`
 * three lines below renders whatever it is given. That asymmetry had no recorded reason, so a
 * reader could not tell a decision from an oversight — and the cheapest way to "fix" an oversight
 * is to add the missing refusal, which here would refuse a value that works.
 *
 * `href` on a `<link>` is a URL-typed attribute resolved against the document's own base, so
 * `canonical="/contacts"` on `https://mycrm.com/x` IS `https://mycrm.com/contacts`. `content` on a
 * `<meta>` is a plain string with no base, which is why Open Graph requires an absolute URL.
 *
 * These cases pin the DECISION, not an implementation detail: a future refusal added to
 * `canonical` fails here and has to argue with this file rather than land quietly.
 */
describe('a relative canonical is passed through (B-243)', () => {
  it('test_a_relative_canonical_renders_unchanged_in_development', () => {
    const before = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const html = renderToStaticMarkup(createElement(Metadata, { canonical: '/contacts' }))
      expect(html).toContain('rel="canonical"')
      expect(html, 'the value was rewritten or refused').toContain('href="/contacts"')
    } finally {
      process.env.NODE_ENV = before
    }
  })

  it('test_the_sibling_ogImage_is_still_refused_in_development', () => {
    // The control. Without it this file would pass on a build where BOTH checks were removed,
    // which is the opposite decision arriving as a silent regression.
    const before = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      expect(() => renderToStaticMarkup(createElement(Metadata, { ogImage: '/card.png' }))).toThrow(
        /must be an absolute URL/i,
      )
    } finally {
      process.env.NODE_ENV = before
    }
  })

  it('test_an_absolute_canonical_renders_unchanged_too', () => {
    const html = renderToStaticMarkup(
      createElement(Metadata, { canonical: 'https://mycrm.com/contacts' }),
    )
    expect(html).toContain('href="https://mycrm.com/contacts"')
  })
})
