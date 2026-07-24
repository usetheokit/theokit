/**
 * CSS Resource Injection — render CSS as <link> or <style> tags.
 *
 * Inspired by Next.js render-css-resource.tsx (app-render/).
 * Supports React 19 precedence attribute for resource ordering.
 */

/** Describes a CSS resource — either external (href) or inline (content). */
interface CssResource {
  /** External CSS URL. */
  href?: string
  /** Inline CSS content. */
  content?: string
  /** React 19 precedence attribute for resource ordering. */
  precedence?: string
}

/**
 * Render a CSS resource as an HTML string.
 *
 * - External CSS (href) → `<link rel="stylesheet" href="..." precedence="...">`
 * - Inline CSS (content) → `<style precedence="...">content</style>`
 * - Dev mode appends `?v=<timestamp>` to external hrefs for cache busting.
 *
 * @returns HTML string for the CSS resource, or empty string if neither
 *          href nor content is provided.
 */
export function renderCssResource(resource: CssResource, isDev?: boolean): string {
  if (resource.href) {
    const href = isDev ? `${resource.href}?v=${Date.now()}` : resource.href
    const precedenceAttr = resource.precedence ? ` precedence="${resource.precedence}"` : ''
    return `<link rel="stylesheet" href="${href}"${precedenceAttr}>`
  }

  if (resource.content) {
    const precedenceAttr = resource.precedence ? ` precedence="${resource.precedence}"` : ''
    return `<style${precedenceAttr}>${resource.content}</style>`
  }

  return ''
}
