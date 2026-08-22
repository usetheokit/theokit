import { describe, it, expect, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Metadata, type MetadataProps } from '../../packages/theo/src/client/metadata.js'

/**
 * B-031 — a relative `og:image` ships and the social card is broken for everyone
 * except the author.
 *
 * The Open Graph protocol requires an absolute URL. A crawler handed `/og.png`
 * resolves it against ITS own origin, so the tag is present, well-formed and
 * useless — and nobody finds out until the link has already been shared, which
 * is the one moment the card exists to serve.
 *
 * ## Why this fails in development and not in production
 *
 * The item asked for a build-time refusal. `Metadata` is a runtime component
 * with no build-time extraction — its docstring says so, and React 19's native
 * hoisting is why it needs none — so there is no build step to refuse in.
 *
 * Throwing in production would be worse than the defect: it turns a broken
 * social card into a 500 on a page that otherwise renders. Throwing in
 * development puts the failure in front of the only person who can fix it, at
 * the moment they wrote it, and costs a production page nothing. That asymmetry
 * is the whole design, and it follows the `NODE_ENV` precedent already used in
 * `server/http/action-execute.ts` and `server/cost/track-agent-run.ts`.
 */

const original = process.env.NODE_ENV

afterEach(() => {
  process.env.NODE_ENV = original
})

function render(props: MetadataProps): string {
  return renderToStaticMarkup(createElement(Metadata, props))
}

describe('Metadata refuses a relative og:image where it can be fixed (B-031)', () => {
  it('test_a_relative_og_image_is_refused_by_name_in_development', () => {
    process.env.NODE_ENV = 'development'

    // Names the prop, the value, and why it cannot work — not "invalid props".
    expect(() => render({ title: 't', ogImage: '/og/contacts.png' })).toThrow(/ogImage/)
    expect(() => render({ title: 't', ogImage: '/og/contacts.png' })).toThrow(/absolute/i)
  })

  it('test_the_same_page_still_renders_in_production', () => {
    process.env.NODE_ENV = 'production'

    // A broken card is a defect; a 500 on a page that otherwise works is an
    // outage. The refusal must never trade the first for the second.
    const html = render({ title: 't', ogImage: '/og/contacts.png' })

    expect(html).toContain('/og/contacts.png')
  })

  it('test_an_absolute_url_passes_in_development', () => {
    process.env.NODE_ENV = 'development'

    expect(render({ title: 't', ogImage: 'https://example.com/og.png' })).toContain(
      'https://example.com/og.png',
    )
  })

  it('test_a_protocol_relative_url_passes', () => {
    process.env.NODE_ENV = 'development'

    // `//cdn.example.com/og.png` resolves against the PAGE's scheme, not the
    // crawler's origin, so it is not the defect this guards.
    expect(render({ title: 't', ogImage: '//cdn.example.com/og.png' })).toContain(
      '//cdn.example.com/og.png',
    )
  })

  it('test_a_data_uri_passes', () => {
    process.env.NODE_ENV = 'development'

    // Unusual, and self-contained by construction — there is no origin to
    // resolve it against wrongly.
    expect(render({ title: 't', ogImage: 'data:image/png;base64,iVBORw0KGgo=' })).toContain('data:')
  })

  it('test_no_og_image_is_not_a_refusal', () => {
    process.env.NODE_ENV = 'development'

    // The prop is optional and omitting it is a legitimate choice.
    expect(() => render({ title: 't' })).not.toThrow()
  })
})
