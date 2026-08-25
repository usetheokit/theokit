---
'theokit': patch
---

`useAction` no longer loses the field map of a validation error that arrives without its issues.

The wire carries both `issues` and the derived `fields` (`server/http/serialize-action-result.ts`), and `ActionError.fromJson` reads `issues`. An error carrying only the map — a hand-written action, or a test fixture — had nothing for it to read, so it fell through to `INTERNAL_SERVER_ERROR` with the map gone. `fields` is the entire reason a form library subscribes to this error.

The map is now inverted back into the issues it was derived from, and `ActionInputError` re-derives an identical one — dot paths, array indices and the empty-string root key intact.

Found by `@theokit/plugin-forms`' own suite while swapping it off `@theokit/react`.
