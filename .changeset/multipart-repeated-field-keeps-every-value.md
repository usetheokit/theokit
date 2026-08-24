---
'theokit': patch
---

A multipart form field that appears more than once now delivers every value instead of only the last.

Posting `tags=a`, `tags=b`, `tags=c` — what a `<select multiple>` or a group of checkboxes sends — reached the action's schema as the single string `'c'`. Nothing errored: the shape was plausible, just missing two thirds of the submission, so a `z.array(z.string())` field either failed validation or silently recorded one answer.

Both parsers were affected (the Node/Busboy path and the Web/Fetch one), and so was the step that rebuilds a `FormData` for `accept: 'form'` actions, where an array would have stringified to `'a,b'`.

A field that appears once is still a plain string, so `input.name.trim()` in existing actions is unchanged. Only a repeated field becomes an array — which is the shape `z.array(...)` already expected.

Also fixed while here: a field named `constructor`, `toString` or `__proto__` was matched against `Object.prototype` rather than against the fields collected so far. Field names come off the wire.
