import { describe, it, expect } from 'vitest'

import {
  extractHeadTags,
  hoistHeadTags,
  injectIntoHead,
  metadataKey,
} from '../../packages/theo/src/vite-plugin/hoist-head-tags.js'

/**
 * React 19 hoists `<title>`/`<meta>`/`<link>` into the head in the BROWSER, after hydration. On the
 * server it emits them inline, and the SSR output lands inside `<div id="root">` — so a route's
 * metadata ships in the body.
 *
 * Readers never notice. Crawlers only see the body version, and the ones that matter for social
 * previews do not run JavaScript at all, so every page unfurls with whatever static fallback
 * `index.html` carries (usetheokit/theokit#319).
 */

const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Site — fallback</title>
    <meta name="description" content="fallback description" />
    <meta property="og:image" content="https://example.com/og.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`

describe('metadataKey', () => {
  it('keys a title', () => {
    expect(metadataKey('<title>x</title>')).toBe('title')
  })

  it('keys meta by property, then by name', () => {
    expect(metadataKey('<meta property="og:title" content="x"/>')).toBe('property:og:title')
    expect(metadataKey('<meta name="description" content="x"/>')).toBe('name:description')
  })

  it('keys only the single-valued link rels', () => {
    expect(metadataKey('<link rel="canonical" href="/x"/>')).toBe('link:canonical')
    // Additive: several stylesheets and preconnects coexist, so none may evict another.
    expect(metadataKey('<link rel="stylesheet" href="/a.css"/>')).toBeUndefined()
    expect(metadataKey('<link rel="preconnect" href="https://x"/>')).toBeUndefined()
  })

  it('returns undefined for a meta with neither name nor property', () => {
    expect(metadataKey('<meta charset="utf-8"/>')).toBeUndefined()
  })
})

describe('extractHeadTags', () => {
  it('pulls the metadata out and leaves the content', () => {
    const rendered = `<div><title>Agent decorators — TheoKit</title><meta name="description" content="the 15 decorators"/><h1>Agent decorators</h1></div>`

    const { html, headTags } = extractHeadTags(rendered)

    expect(headTags).toHaveLength(2)
    expect(headTags[0]).toContain('Agent decorators — TheoKit')
    expect(html).toContain('<h1>Agent decorators</h1>')
    expect(html).not.toContain('<title>')
  })

  it('leaves markup with no metadata untouched', () => {
    const rendered = '<div><h1>Hello</h1><p>Body</p></div>'
    expect(extractHeadTags(rendered)).toEqual({ html: rendered, headTags: [] })
  })
})

describe('injectIntoHead', () => {
  it('places the tags before </head>', () => {
    const out = injectIntoHead(TEMPLATE, ['<title>Page</title>'])
    const head = out.slice(0, out.indexOf('</head>'))

    expect(head).toContain('<title>Page</title>')
  })

  it('drops the template tag the route supersedes', () => {
    const out = injectIntoHead(TEMPLATE, [
      '<title>Page</title>',
      '<meta name="description" content="page description"/>',
    ])

    expect(out).not.toContain('Site — fallback')
    expect(out).not.toContain('fallback description')
    expect(out).toContain('<title>Page</title>')
    expect(out).toContain('page description')
  })

  it('keeps the template tags a route does not supersede', () => {
    const out = injectIntoHead(TEMPLATE, ['<title>Page</title>'])

    // Not overridden by the route, so the site-wide value must survive.
    expect(out).toContain('og:image')
    expect(out).toContain('rel="preconnect"')
    expect(out).toContain('charset="utf-8"')
  })

  it('emits exactly one title', () => {
    const out = injectIntoHead(TEMPLATE, ['<title>Page</title>'])
    expect([...out.matchAll(/<title>/g)]).toHaveLength(1)
  })

  it('returns the template unchanged when there is nothing to hoist', () => {
    expect(injectIntoHead(TEMPLATE, [])).toBe(TEMPLATE)
  })

  it('returns the template unchanged when it has no head', () => {
    const headless = '<div id="root"></div>'
    expect(injectIntoHead(headless, ['<title>Page</title>'])).toBe(headless)
  })
})

describe('hoistHeadTags', () => {
  it('moves a route’s metadata from the body into the head', () => {
    const rendered = `<div><title>Quick start — TheoKit</title><link rel="canonical" href="https://theokit.dev/docs/getting-started"/><meta property="og:title" content="Quick start — TheoKit"/><h1>Quick start</h1></div>`

    const { template, html } = hoistHeadTags(TEMPLATE, rendered)
    const head = template.slice(0, template.indexOf('</head>'))

    expect(head).toContain('Quick start — TheoKit')
    expect(head).toContain('rel="canonical"')
    expect(head).toContain('og:title')

    // And the body keeps the content, without the metadata.
    expect(html).toContain('<h1>Quick start</h1>')
    expect(html).not.toContain('<title>')
    expect(html).not.toContain('og:title')
  })

  it('lets the route win over the site-wide fallback', () => {
    const rendered = '<div><title>Page</title><meta name="description" content="page"/></div>'
    const { template } = hoistHeadTags(TEMPLATE, rendered)

    expect(template).not.toContain('Site — fallback')
    expect(template).not.toContain('fallback description')
    expect([...template.matchAll(/name="description"/g)]).toHaveLength(1)
  })
})
