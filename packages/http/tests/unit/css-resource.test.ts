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
