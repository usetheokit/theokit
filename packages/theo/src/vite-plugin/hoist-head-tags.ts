/**
 * Moves the document metadata a route rendered into the `<head>` where it belongs.
 *
 * ## Why this exists
 *
 * React 19 hoists `<title>`, `<meta>` and `<link>` into the head — **in the browser**, by moving
 * DOM nodes after hydration. On the server it emits them inline, wherever the component sat, and
 * the SSR output is injected inside `<div id="root">`. So a route's own metadata ships in the
 * BODY.
 *
 * For a reader that changes nothing: hydration moves the tags a moment later. For a crawler it
 * changes everything, because the ones that matter never run JavaScript. Every social unfurler —
 * X, LinkedIn, Slack, Discord, WhatsApp — reads the served `<head>` and stops. Without this, every
 * page of a site unfurls with whatever static fallback `index.html` happens to carry: share ten
 * different documentation pages, get ten identical cards.
 *
 * Turning SSR on to fix social previews and finding they still do not work is a bad afternoon, so
 * the framework does the hoist itself (usetheokit/theokit#319).
 *
 * ## Precedence
 *
 * The route wins over the template. `index.html` holds site-wide defaults; a page that states its
 * own title, description or canonical is being specific on purpose, and shipping both would leave
 * the crawler to pick — in practice the first one, which is the generic one.
 */

/**
 * Tags React hoists, and therefore the ones worth moving.
 *
 * Two separate patterns rather than one with an alternation: a single expression covering both the
 * self-closing tags and the `<title>…</title>` pair needs a lazy `[\s\S]*?` next to a lazy
 * `[^>]*?`, and that nests two unbounded quantifiers — catastrophic backtracking on hostile input,
 * which here is a served HTML document. Each pattern below is linear: `[^>]` and `[^<]` cannot
 * cross the delimiter that ends the match.
 */
const VOID_METADATA = /<(?:meta|link)\b[^>]*>/gi
/** `<title>` content is text, so it cannot contain `<` — the class is what keeps this linear. */
const TITLE_TAG = /<title\b[^>]*>[^<]*<\/title>/gi

/** Runs `replacer` over every hoistable tag, in document order. */
function replaceHoistable(html: string, replacer: (tag: string) => string): string {
  return html.replace(TITLE_TAG, replacer).replace(VOID_METADATA, replacer)
}

/**
 * The identity of a metadata tag, used to decide what the route replaces.
 *
 * `<meta name="description">` and `<meta property="og:title">` are distinct slots; two `<meta>`
 * tags with different names are not duplicates. A `<link>` is keyed by `rel`, so a route's
 * canonical replaces the template's while a stylesheet link is left alone.
 *
 * Anything unkeyed (a `<link rel="preconnect">`, say) returns `undefined` and is simply appended —
 * additive tags must not evict each other.
 */
export function metadataKey(tag: string): string | undefined {
  if (/^<title\b/i.test(tag)) return 'title'

  const name = /\bname=["']([^"']+)["']/i.exec(tag)?.[1]
  const property = /\bproperty=["']([^"']+)["']/i.exec(tag)?.[1]
  const rel = /\brel=["']([^"']+)["']/i.exec(tag)?.[1]

  if (/^<meta\b/i.test(tag)) {
    if (property !== undefined) return `property:${property.toLowerCase()}`
    if (name !== undefined) return `name:${name.toLowerCase()}`
    return undefined
  }

  if (/^<link\b/i.test(tag) && rel !== undefined) {
    const slug = rel.toLowerCase()
    // Only single-valued rels are slots. `stylesheet`, `preload` and friends are additive: keying
    // them would let one page's stylesheet evict another's.
    return slug === 'canonical' || slug === 'manifest' ? `link:${slug}` : undefined
  }

  return undefined
}

export interface HoistedHead {
  /** The rendered HTML with its metadata tags removed. */
  html: string
  /** Those tags, ready to be placed in the head. */
  headTags: string[]
}

/** Pulls hoistable metadata out of rendered SSR markup. */
export function extractHeadTags(ssrHtml: string): HoistedHead {
  const headTags: string[] = []
  const html = replaceHoistable(ssrHtml, (tag) => {
    headTags.push(tag)
    return ''
  })
  return { html, headTags }
}

/**
 * Inserts `headTags` into the template's head, dropping any template tag the route supersedes.
 *
 * Returns the template untouched when there is nothing to hoist or no `</head>` to hoist into —
 * a missing head is a malformed template, and rewriting it further would not help anyone.
 */
export function injectIntoHead(template: string, headTags: string[]): string {
  if (headTags.length === 0) return template

  const closingHead = template.toLowerCase().lastIndexOf('</head>')
  if (closingHead === -1) return template

  const supersededKeys = new Set(
    headTags.map((tag) => metadataKey(tag)).filter((key): key is string => key !== undefined),
  )

  let head = template.slice(0, closingHead)
  if (supersededKeys.size > 0) {
    head = replaceHoistable(head, (tag) => {
      const key = metadataKey(tag)
      return key !== undefined && supersededKeys.has(key) ? '' : tag
    })
  }

  return `${head}    ${headTags.join('\n    ')}\n  ${template.slice(closingHead)}`
}

/**
 * The whole operation: strip metadata from the rendered markup and place it in the template's head.
 */
export function hoistHeadTags(
  template: string,
  ssrHtml: string,
): { template: string; html: string } {
  const { html, headTags } = extractHeadTags(ssrHtml)
  const hoisted = injectIntoHead(template, headTags)

  // Fail SAFE, not silent. `injectIntoHead` returns the template untouched when it finds no
  // `</head>` — and if we returned the stripped body alongside it, the metadata would be removed
  // from one place and added to neither. It would vanish, with nothing to show for it.
  //
  // That is not hypothetical: a template whose COMMENT mentioned `<div id="root">` split at the
  // comment, leaving a "head" half with no `</head>` in it, and every route silently lost its
  // title and canonical. Metadata in the wrong place still works after hydration; metadata that is
  // gone never comes back.
  if (hoisted === template) return { template, html: ssrHtml }

  return { template: hoisted, html }
}
