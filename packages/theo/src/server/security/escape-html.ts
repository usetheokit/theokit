/**
 * HTML escaping, said once by the framework instead of re-derived by every app
 * (usetheokit/theokit#611).
 *
 * ## Why this is a framework primitive and not four lines each app writes
 *
 * The framework already had this function — private, inside the OpenAPI docs renderer, reachable
 * from no subpath. An adopter building an HTML e-mail body wrote it again: same four characters,
 * same order, same omission of `'`. Neither escaped the apostrophe.
 *
 * That omission is the whole point. Escaping `& < > "` is CORRECT for text content and INSUFFICIENT
 * inside a single-quoted attribute, where `'` closes the value and everything after it is markup.
 * Both call sites happened to be text content, so both were right by luck rather than by having
 * been told — and the app that eventually writes `href='${value}'` inherits the luck without the
 * caveat.
 *
 * The fix is two functions with two names, so the decision is visible where the interpolation
 * happens rather than buried in a docblock somebody may not have read. Same shape as #574
 * (`@Public()`, `Authenticated()`): the framework owns the primitive, so it owns the caveat too.
 *
 * ## What this is NOT
 *
 * Neither function sanitises HTML — they ESCAPE it, turning markup into text. Accepting untrusted
 * markup and rendering part of it is a different problem with a different answer (a sanitiser with
 * an allow-list, e.g. DOMPurify); do not reach for these to solve it.
 *
 * Neither is sufficient inside a `<script>` or `<style>` element, or in a `javascript:` /
 * `data:` URL, or in an unquoted attribute value. Those contexts do not treat `&` as an entity
 * introducer at all, so escaping cannot make a value safe there — the value has to be validated or
 * kept out.
 */

/**
 * The single table both functions read, so the two can never disagree about what `&` becomes.
 *
 * Numeric references (`&#39;`, `&#96;`) rather than named ones (`&apos;`) because `&apos;` is
 * HTML5-only — it is not defined in HTML 4.01, and a legacy parser renders it literally, putting
 * the apostrophe back exactly where escaping was supposed to remove it.
 */
const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
})

/**
 * One pass over the string, not one pass per character class.
 *
 * The chained-`replace` idiom both copies of this function used is also the idiom that gets the
 * ORDER wrong: run `&` last and `<` has already become `&lt;`, which the ampersand pass then turns
 * into `&amp;lt;`. A single character-class pass has no order to get wrong, and allocates one
 * intermediate string instead of four.
 */
function escapeWith(value: string, pattern: RegExp): string {
  return value.replace(pattern, (char) => ENTITIES[char])
}

const TEXT_PATTERN = /[&<>"']/g
const ATTRIBUTE_PATTERN = /[&<>"'`]/g

/**
 * Escapes a value for interpolation into HTML **text content**.
 *
 * ```ts
 * `<title>${escapeHtml(title)}</title>`
 * ```
 *
 * Escapes `& < > " '`. The two quotes are not required in a text node and cost nothing, and
 * including them means a value that later moves into a quoted attribute does not silently become
 * an injection point.
 *
 * NOT sufficient for an unquoted attribute value, or inside `<script>`, `<style>`, or a URL
 * scheme — see the module docblock.
 *
 * @param value the untrusted string to render as text
 * @returns the same string with HTML-significant characters replaced by entities
 */
export function escapeHtml(value: string): string {
  return escapeWith(value, TEXT_PATTERN)
}

/**
 * Escapes a value for interpolation into a **quoted HTML attribute value**.
 *
 * ```ts
 * `<a href="${escapeHtmlAttribute(url)}">`   // double-quoted — fine
 * `<a href='${escapeHtmlAttribute(url)}'>`   // single-quoted — also fine
 * ```
 *
 * Everything `escapeHtml` escapes, plus the backtick: old IE accepts `` ` `` as an attribute
 * delimiter, so a value containing one can break out of an otherwise correctly quoted attribute.
 *
 * The attribute MUST be quoted. In `<a href=${value}>` a space ends the value and the rest of the
 * string becomes new attributes, and no amount of entity escaping changes that — quote it.
 *
 * @param value the untrusted string to render inside a quoted attribute
 * @returns the same string with HTML-significant characters replaced by entities
 */
export function escapeHtmlAttribute(value: string): string {
  return escapeWith(value, ATTRIBUTE_PATTERN)
}
