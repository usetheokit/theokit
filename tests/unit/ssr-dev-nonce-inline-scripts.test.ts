import { describe, it, expect } from 'vitest'

import { applyNonceToInlineScripts } from '../../packages/theo/src/vite-plugin/ssr-dev-middleware.js'

/**
 * With SSR on, the dev server serves a nonce-based `script-src`. Vite plugins inject their own
 * inline scripts through `transformIndexHtml` and know nothing about that nonce — most importantly
 * `@vitejs/plugin-react`, whose refresh preamble is an inline module script.
 *
 * Unstamped, the browser blocks it, `window.$RefreshReg$` never exists, and the first component
 * module throws "@vitejs/plugin-react can't detect preamble". SSR already produced the HTML, so the
 * page renders and simply never hydrates: no theme, no event handlers, no interactivity, and a
 * console error that points at Vite instead of at the framework (usetheokit/theokit#319).
 */

const NONCE = 'QtmCY4ekXnrqFlAWbuvtvw=='

describe('applyNonceToInlineScripts', () => {
  it('stamps the React refresh preamble', () => {
    const preamble = `<script type="module">import { injectIntoGlobalHook } from "/@react-refresh";
injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};</script>`

    const out = applyNonceToInlineScripts(preamble, NONCE)

    expect(out).toContain(`nonce="${NONCE}"`)
    expect(out).toContain('type="module"')
    // The body must survive untouched — it is executable code, not markup to rewrite.
    expect(out).toContain('window.$RefreshReg$ = () => {};')
  })

  it('leaves scripts with a src alone — `self` already covers those', () => {
    const html = '<script type="module" src="/@vite/client"></script>'
    expect(applyNonceToInlineScripts(html, NONCE)).toBe(html)
  })

  it('does not double-stamp a script that already carries a nonce', () => {
    const html = `<script nonce="existing">window.x = 1</script>`
    const out = applyNonceToInlineScripts(html, NONCE)

    expect(out).toBe(html)
    expect(out).not.toContain(NONCE)
  })

  it('stamps several inline scripts in one document', () => {
    const html = [
      '<script type="module">a()</script>',
      '<script src="/app.js"></script>',
      '<script>b()</script>',
    ].join('\n')

    const out = applyNonceToInlineScripts(html, NONCE)
    const stamped = [...out.matchAll(new RegExp(`nonce="${NONCE}"`, 'g'))]

    expect(stamped).toHaveLength(2)
    expect(out).toContain('<script src="/app.js"></script>')
  })

  it('stamps a JSON-LD block without altering its contents', () => {
    // Not executable, so browsers do not block it — but stamping is harmless and keeps the rule
    // simple: every inline script tag gets the nonce.
    const html = '<script type="application/ld+json">{"@type":"WebSite"}</script>'
    const out = applyNonceToInlineScripts(html, NONCE)

    expect(out).toContain('{"@type":"WebSite"}')
    expect(out).toContain(`nonce="${NONCE}"`)
  })

  it('is a no-op on markup with no scripts', () => {
    const html = '<html><head><title>x</title></head><body></body></html>'
    expect(applyNonceToInlineScripts(html, NONCE)).toBe(html)
  })

  it('does not touch text that merely mentions a script tag', () => {
    // `<script` inside an attribute value or text node is not an opening tag we should rewrite.
    const html = '<p>write &lt;script&gt; to embed</p>'
    expect(applyNonceToInlineScripts(html, NONCE)).toBe(html)
  })
})
