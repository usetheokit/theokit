/**
 * Read an adapter's source with comments removed, without being fooled by a string that looks like one.
 *
 * Seven test files carried a byte-identical copy of this:
 *
 * a two-step regex replace: one pattern matching a block comment lazily from its opener to its
 * terminator, then one matching a line comment guarded by a preceding non-colon character so a URL
 * survives. The patterns are described rather than quoted, because a regex that matches a comment
 * terminator CONTAINS one — quoting it here closed this docblock and esbuild parsed the rest as code.
 *
 * It has no notion of strings, and `netlify.ts` emits a Netlify redirect whose glob is `"/*"`. That
 * opened a block comment the regex then closed at the next terminator, so **5764 of 16204 bytes — 36%
 * file — vanished** before any sweep looked at it. Measured 2026-09-29 (B-338).
 *
 * The consequence was a guard named `every deployed entry is told its server dir` that could not see the
 * one adapter which was not told: `serverDirLiteral(opts)` appeared twice in the raw source and zero
 * times after stripping. The file passed, and `/api/health` answered 404 on the Netlify emulator.
 *
 * ## The trade-off, measured rather than assumed
 *
 * A template literal is treated as a STRING here, which is what stops the `"/*"` from opening a comment.
 * The cost is that comments INSIDE emitted templates — the prose an adapter writes into the entry it
 * generates — are no longer removed, so a sweep matching a call name can match it in emitted prose. That
 * direction was chosen deliberately: a false positive is visible and fixable, a false negative is a guard
 * reporting clean over code it never read. Every sweep that consumes this was run against it.
 */

type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template'

/** Source with real comments removed. Strings and template literals are left intact. */
export function withoutComments(source: string): string {
  let out = ''
  let state: State = 'code'
  let i = 0

  while (i < source.length) {
    const c = source[i] as string
    const next = source[i + 1]

    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line'
        i += 2
        continue
      }
      if (c === '/' && next === '*') {
        state = 'block'
        i += 2
        continue
      }
      if (c === "'") state = 'single'
      else if (c === '"') state = 'double'
      else if (c === '`') state = 'template'
      out += c
      i += 1
      continue
    }

    if (state === 'line') {
      // The newline is kept so line numbers and line-anchored patterns still work.
      if (c === '\n') {
        state = 'code'
        out += c
      }
      i += 1
      continue
    }

    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code'
        i += 2
      } else {
        // Newlines are kept for the same reason.
        if (c === '\n') out += c
        i += 1
      }
      continue
    }

    // Inside a string of some kind. An escape consumes the next character whatever it is.
    if (c === '\\') {
      out += c + (next ?? '')
      i += 2
      continue
    }
    if (
      (state === 'single' && c === "'") ||
      (state === 'double' && c === '"') ||
      (state === 'template' && c === '`')
    ) {
      state = 'code'
    }
    out += c
    i += 1
  }

  return out
}
