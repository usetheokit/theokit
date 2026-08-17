/**
 * Locates the app's mount point in an HTML template, ignoring anything inside a comment.
 *
 * ## Why this is not a plain regex
 *
 * Three places split `index.html` on `<div id="root">` to insert rendered HTML. A bare regex also
 * matches the string inside an HTML COMMENT, and a template that merely *mentions* the mount point
 * in a comment — documenting how SSR works, say — gets split at the comment instead.
 *
 * The failure is silent and confusing: the split lands before `</head>`, so the "head" half holds
 * no `</head>` at all. Everything downstream that expects to insert into the head quietly does
 * nothing, and the rendered page loses its metadata with no error anywhere. It cost an afternoon to
 * find, because the template looks perfectly ordinary and the comment is invisible in the browser.
 *
 * Comments are masked with spaces rather than removed, so every index the caller receives still
 * refers to the ORIGINAL string.
 */

/** Replaces the contents of every HTML comment with spaces, preserving length and indices. */
export function maskHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length))
}

const ROOT_DIV = /<div id=["']root["'][^>]*>/

export interface RootDivMatch {
  /** The matched opening tag, exactly as it appears in the template. */
  tag: string
  /** Index just past the opening tag — where rendered HTML is inserted. */
  insertAt: number
}

/**
 * Finds the real mount point, or `undefined` when the template has none.
 *
 * Callers treat `undefined` as "serve the template unchanged", which is the honest response to a
 * template with nowhere to mount.
 */
export function findRootDiv(html: string): RootDivMatch | undefined {
  const match = ROOT_DIV.exec(maskHtmlComments(html))
  if (match === null) return undefined

  // The mask preserves offsets, so the index is valid against the original string.
  return {
    tag: html.slice(match.index, match.index + match[0].length),
    insertAt: match.index + match[0].length,
  }
}
