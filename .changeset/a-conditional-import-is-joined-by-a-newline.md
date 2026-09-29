---
'theokit': patch
---

The Bun entry's rate-limit import is preceded by a newline, so a project that declares a limit builds

`renderBunEntry` emits three imports where it used to emit one, and the third is conditional on the
project declaring `rateLimit`. That fragment sat in a nested double-quoted string inside a template
literal, where an escaped backslash is a backslash — so the import was joined to the one before it by
two characters, a backslash and an `n`, instead of by a line break. Bun refused the entry:

    SyntaxError: Invalid or unexpected token

Every entry in the parse test, and the scaffold used to verify deploys, declare no rate limit, so the
whole conditional family had never been handed to a parser. The existing unit test renders the
fragment and asserts on the STRING, which a module carrying a literal backslash-n satisfies perfectly.

`tests/unit/adapter-entry-parses.test.ts` now parses a rate-limit variant for all six targets rather
than for the one that broke. The fragment has the same shape everywhere, and covering the instance
would leave the class open — which is how this arrived, one target at a time.
