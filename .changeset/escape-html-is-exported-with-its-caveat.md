---
'theokit': minor
---

**`escapeHtml` is exported, and says which context it is safe in** (#611).

The framework had the function, kept it private inside the OpenAPI docs renderer, and an adopter
building an HTML e-mail body wrote it again — same four characters, same order, same omission of
`'`. Neither escaped the apostrophe, and neither had to: both call sites interpolate into text
content, where four characters are enough. They were right by luck rather than by having been told,
and the caveat is the part that does not survive being re-derived.

`theokit/server/security` now exports two functions with two names, so the decision is visible where
the interpolation happens:

```ts
import { escapeHtml, escapeHtmlAttribute } from 'theokit/server/security'

`<title>${escapeHtml(title)}</title>`        // text content
`<a href='${escapeHtmlAttribute(url)}'>`     // quoted attribute — escapes ' and ` too
```

Both run as a single character-class pass, which also removes the ordering hazard the chained
`.replace()` idiom carries: run the ampersand last and `<` has already become `&lt;`, which the
ampersand pass then turns into `&amp;lt;`. The docs renderer consumes them instead of carrying its
own copy.

Same shape as #574 (`@Public()`, `Authenticated()`): the framework owns the primitive, so it owns
the caveat with it.
