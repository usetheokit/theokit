/**
 * CSS Resource Injection — render CSS as <link> or <style> tags.
 *
 * Inspired by Next.js render-css-resource.tsx (app-render/).
 * Supports React 19 precedence attribute for resource ordering.
 */

/** Describes a CSS resource — either external (href) or inline (content). */
// B-M74-01 — exported because the public function's signature mentions it: a caller that can
// call `CssResource`-shaped API and cannot NAME the type redeclares it by hand, and a second
// declaration of one contract diverges from the first in silence.
export interface CssResource {
  /** External CSS URL. */
  href?: string
  /** Inline CSS content. */
  content?: string
  /** React 19 precedence attribute for resource ordering. */
  precedence?: string
}

// usetheokit/theokit#356 — `href`, `precedence` and `content` are interpolated into markup, so
// every one of them is an injection point the moment this function is reachable from an SSR path.
// It was test-only when written, which is why it shipped unescaped; the escaping lands BEFORE the
// wiring rather than after it, because the order is the whole difference between a latent hole and
// a live one.

/** Escape a value for use inside a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Neutralize a `</style` breakout inside inline CSS.
 *
 * `<style>` is a raw text element: HTML character references are NOT decoded inside it, so
 * attribute-style escaping would corrupt the stylesheet without closing anything. The only way out
 * of the element is the literal end-tag opener, so that is the only sequence rewritten — as the CSS
 * escape `\3c `, which a CSS string parses back to `<`. A bare `<` is left alone because CSS media
 * range syntax (`@media (width < 600px)`) needs it and cannot terminate the element on its own.
 */
function escapeStyleText(value: string): string {
  return value.replace(/<\/(style)/gi, '\\3c /$1')
}

/**
 * Render a CSS resource as an HTML string.
 *
 * - External CSS (href) → `<link rel="stylesheet" href="..." precedence="...">`
 * - Inline CSS (content) → `<style precedence="...">content</style>`
 * - Dev mode appends `?v=<timestamp>` to external hrefs for cache busting.
 *
 * `href` and `precedence` are attribute-escaped and `content` is protected against a `</style`
 * breakout, so a value coming from configuration cannot inject markup.
 *
 * @returns HTML string for the CSS resource, or empty string if neither
 *          href nor content is provided.
 */
export function renderCssResource(resource: CssResource, isDev?: boolean): string {
  const precedenceAttr = resource.precedence
    ? ` precedence="${escapeAttribute(resource.precedence)}"`
    : ''

  if (resource.href) {
    const href = isDev ? `${resource.href}?v=${String(Date.now())}` : resource.href
    return `<link rel="stylesheet" href="${escapeAttribute(href)}"${precedenceAttr}>`
  }

  if (resource.content) {
    return `<style${precedenceAttr}>${escapeStyleText(resource.content)}</style>`
  }

  return ''
}
