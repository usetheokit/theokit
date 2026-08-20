import { describe, it, expect, vi } from 'vitest'
import { renderCssResource } from '../../src/css-resource.js'

describe('CSS Resource Injection', () => {
  it('test_external_css_renders_link_tag', () => {
    // Given: an external CSS resource with precedence
    const resource = { href: '/styles/main.css', precedence: 'default' }

    // When: rendered
    const html = renderCssResource(resource)

    // Then: produces a <link> tag with precedence
    expect(html).toBe('<link rel="stylesheet" href="/styles/main.css" precedence="default">')
  })

  it('test_inline_css_renders_style_tag', () => {
    // Given: an inline CSS resource with precedence
    const resource = { content: 'body { margin: 0; }', precedence: 'high' }

    // When: rendered
    const html = renderCssResource(resource)

    // Then: produces a <style> tag with precedence
    expect(html).toBe('<style precedence="high">body { margin: 0; }</style>')
  })

  it('test_dev_mode_adds_cache_buster', () => {
    // Given: an external CSS resource in dev mode
    const now = 1718100000000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const resource = { href: '/styles/app.css' }

    // When: rendered with isDev=true
    const html = renderCssResource(resource, true)

    // Then: href has cache-busting query param
    expect(html).toBe(`<link rel="stylesheet" href="/styles/app.css?v=${now}">`)

    vi.restoreAllMocks()
  })

  it('test_empty_resource_returns_empty_string', () => {
    // Given: a resource with neither href nor content
    const resource = {}

    // When: rendered
    const html = renderCssResource(resource)

    // Then: empty string
    expect(html).toBe('')
  })
})

/** Count of raw double quotes — one attribute value contributes exactly two. */
function countQuotes(html: string): number {
  return html.split('"').length - 1
}

describe('CSS Resource Injection — HTML injection', () => {
  it('test_href_with_quote_and_tag_is_escaped', () => {
    // Given: an href carrying an attribute-breaking payload
    const resource = { href: '/a.css"><script>alert(1)</script>' }

    // When: rendered
    const html = renderCssResource(resource)

    // Then: the payload cannot leave the attribute
    expect(html).not.toContain('<script>')
    expect(html).toBe(
      '<link rel="stylesheet" href="/a.css&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">',
    )
  })

  it('test_precedence_with_quote_is_escaped', () => {
    // Given: a precedence carrying an attribute-breaking payload
    const resource = { href: '/a.css', precedence: 'default" onload="alert(1)' }

    // When: rendered
    const html = renderCssResource(resource)

    // Then: exactly three attribute values are quoted, so no fourth was synthesized
    expect(countQuotes(html)).toBe(6)
    expect(html).toBe(
      '<link rel="stylesheet" href="/a.css" precedence="default&quot; onload=&quot;alert(1)">',
    )
  })

  it('test_href_ampersand_is_escaped', () => {
    // Given: an href with a query string
    const resource = { href: '/a.css?x=1&y=2' }

    // When: rendered
    const html = renderCssResource(resource)

    // Then: the ampersand is a character reference, not the start of an entity
    expect(html).toBe('<link rel="stylesheet" href="/a.css?x=1&amp;y=2">')
  })

  it('test_dev_cache_buster_is_escaped_too', () => {
    // Given: dev mode and a hostile href
    const now = 1718100000000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const resource = { href: '"><script>alert(1)</script>' }

    // When: rendered with isDev=true
    const html = renderCssResource(resource, true)

    // Then: the cache buster does not reopen the hole
    expect(html).not.toContain('<script>')
    expect(html).toBe(
      `<link rel="stylesheet" href="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;?v=${String(now)}">`,
    )

    vi.restoreAllMocks()
  })

  it('test_inline_content_cannot_close_the_style_element', () => {
    // Given: inline CSS carrying a </style> breakout
    const resource = { content: 'body{}</style><script>alert(1)</script>' }

    // When: rendered
    const html = renderCssResource(resource)

    // Then: the element is closed exactly once, at the end. Everything before that stays raw
    // text, where a `<script>` opener is inert — the breakout is the end tag, not the payload.
    expect(html.indexOf('</style>')).toBe(html.length - '</style>'.length)
    expect(html).toBe('<style>body{}\\3c /style><script>alert(1)</script></style>')
  })

  it('test_inline_content_keeps_css_range_syntax', () => {
    // Given: valid CSS that legitimately contains a less-than sign
    const resource = { content: '@media (width < 600px){body{margin:0}}' }

    // When: rendered
    const html = renderCssResource(resource)

    // Then: the declaration is untouched
    expect(html).toBe('<style>@media (width < 600px){body{margin:0}}</style>')
  })

  it('test_precedence_is_escaped_on_the_inline_branch', () => {
    // Given: an inline resource whose precedence carries a payload
    const resource = { content: 'body{}', precedence: 'high" onload="alert(1)' }

    // When: rendered
    const html = renderCssResource(resource)

    // Then: exactly one attribute value is quoted, so no second was synthesized
    expect(countQuotes(html)).toBe(2)
    expect(html).toBe('<style precedence="high&quot; onload=&quot;alert(1)">body{}</style>')
  })
})
