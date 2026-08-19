import { describe, it, expect } from 'vitest'

import {
  findRootDiv,
  maskHtmlComments,
} from '../../packages/theo/src/core/contracts/find-root-div.js'
import { hoistHeadTags } from '../../packages/theo/src/vite-plugin/hoist-head-tags.js'

/**
 * Three code paths split `index.html` on `<div id="root">`. A bare regex also matches the string
 * inside an HTML comment, so a template that merely documents its own mount point in a comment gets
 * split at the comment.
 *
 * The consequence is silent: the split lands before `</head>`, so the "head" half contains no
 * `</head>`, head injection quietly does nothing, and every rendered page loses its metadata with no
 * error raised anywhere.
 */

const TEMPLATE_WITH_COMMENT = `<!doctype html>
<html>
  <head>
    <!--
      Per-page tags are absent on purpose: the framework injects SSR output inside
      \`<div id="root">\`, so a tag here would win over the route's own.
    -->
    <title>Site</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`

describe('maskHtmlComments', () => {
  it('blanks comment contents and preserves length', () => {
    const html = '<p>a</p><!-- hidden --><p>b</p>'
    const masked = maskHtmlComments(html)

    expect(masked).toHaveLength(html.length)
    expect(masked).not.toContain('hidden')
    expect(masked.startsWith('<p>a</p>')).toBe(true)
    expect(masked.endsWith('<p>b</p>')).toBe(true)
  })
})

describe('findRootDiv', () => {
  it('finds the real mount point, not the one named in a comment', () => {
    const found = findRootDiv(TEMPLATE_WITH_COMMENT)

    expect(found).toBeDefined()
    // The real div sits after </head>; the commented mention comes before it.
    expect(found?.insertAt).toBeGreaterThan(TEMPLATE_WITH_COMMENT.indexOf('</head>'))
  })

  it('splits so the head half still contains </head>', () => {
    const found = findRootDiv(TEMPLATE_WITH_COMMENT)
    expect(found).toBeDefined()
    const head = TEMPLATE_WITH_COMMENT.slice(0, found?.insertAt ?? 0)

    // This is the invariant everything downstream depends on.
    expect(head).toContain('</head>')
  })

  it('returns the tag exactly as written', () => {
    expect(findRootDiv(`<div id='root' class="app">x</div>`)?.tag).toBe(
      `<div id='root' class="app">`,
    )
  })

  it('returns undefined when there is no mount point', () => {
    expect(findRootDiv('<html><body></body></html>')).toBeUndefined()
  })

  it('returns undefined when the ONLY mention is inside a comment', () => {
    expect(findRootDiv('<html><!-- <div id="root"></div> --></html>')).toBeUndefined()
  })
})

describe('hoistHeadTags — fail safe', () => {
  it('keeps the metadata in the body when it cannot reach the head', () => {
    // Removing tags from one place and adding them to neither is the one outcome worse than
    // leaving them where they are: after hydration, body tags still work — deleted ones never do.
    const noHead = '<div id="root">'
    const rendered = '<title>Page</title><h1>Page</h1>'

    const { template, html } = hoistHeadTags(noHead, rendered)

    expect(template).toBe(noHead)
    expect(html).toContain('<title>Page</title>')
  })

  it('still hoists when the head is present', () => {
    const { template, html } = hoistHeadTags(
      '<html><head><title>Site</title></head><body><div id="root">',
      '<title>Page</title><h1>Page</h1>',
    )

    expect(template).toContain('<title>Page</title>')
    expect(template).not.toContain('<title>Site</title>')
    expect(html).not.toContain('<title>')
  })
})
