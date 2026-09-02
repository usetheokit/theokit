import { describe, it, expect } from 'vitest'

import {
  escapeHtml,
  escapeHtmlAttribute,
} from '../../packages/theo/src/server/security/escape-html.js'

/**
 * #611 — the framework had `escapeHtml`, kept it private inside the OpenAPI docs renderer, and
 * every adopter re-derived it. Re-derived means re-derived WITHOUT the caveat: the four characters
 * are enough for text content and are not enough inside a single-quoted attribute, and nothing
 * told the app that wrote `href='...'` it had crossed a line.
 *
 * Two functions with two names is the fix: the choice becomes visible at the call site instead of
 * living in whoever read the docblock.
 */
describe('escapeHtml — HTML text content (#611)', () => {
  it('escapes the five characters that terminate a text node or an attribute', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('escapes the ampersand FIRST so an escaped entity is not double-escaped', () => {
    // A naive implementation that runs `&` last turns `<` into `&lt;` and then into `&amp;lt;`.
    expect(escapeHtml('<')).toBe('&lt;')
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('neutralises a script payload interpolated into a text node', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('leaves a string with nothing to escape byte-identical', () => {
    // Non-Latin scripts pass through untouched; Latin diacritics would trip the repo's
    // English-only sweep, and this assertion does not need them to make its point.
    const clean = 'Theo API v1.2.3 (日本語)'
    expect(escapeHtml(clean)).toBe(clean)
  })

  it('returns an empty string for an empty input', () => {
    expect(escapeHtml('')).toBe('')
  })
})

describe('escapeHtmlAttribute — HTML attribute values (#611)', () => {
  it('escapes the single quote, which is what breaks out of a single-quoted attribute', () => {
    // The exact case the issue names: `href='...'` with an apostrophe in the value.
    expect(escapeHtmlAttribute(`' onerror='alert(1)`)).toBe('&#39; onerror=&#39;alert(1)')
  })

  it('escapes the backtick, which delimits an attribute value in older IE', () => {
    expect(escapeHtmlAttribute('`')).toBe('&#96;')
  })

  it('escapes the double quote for double-quoted attributes', () => {
    expect(escapeHtmlAttribute('" onerror="alert(1)')).toBe('&quot; onerror=&quot;alert(1)')
  })

  it('escapes everything escapeHtml does', () => {
    const payload = `&<>"'`
    for (const char of payload) {
      expect(escapeHtmlAttribute(char)).not.toBe(char)
    }
  })
})
