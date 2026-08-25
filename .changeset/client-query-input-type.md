---
"theokit": patch
---

The generated client types a request with what the caller SENDS, not with what the handler receives.

`InferQuery` and `InferBody` used `z.infer`, which is `z.output` — the value produced after parsing,
with defaults filled in and transforms applied. A client sends the value before any of that, so
typing the request with the output inverted the two and punished exactly the schemas that were
written correctly (usetheokit/theokit#490):

- **A `.default()` field became required at the call site.** `query: {}` failed to compile against a
  schema whose every field was optional or defaulted, which is the opposite of what declaring a
  default means.
- **A `.transform()` field asked for the post-transform type.** A querystring flag declared as
  `z.enum(['true','false','1','0']).default('false').transform(v => v === 'true')` — the shape a
  boolean flag needs, since `z.coerce.boolean()` reads `'false'` as `true` — required a `boolean`
  from the caller for a value that has to reach the server as a string. The type described something
  that never travels.

Both now use `z.input`. The handler side keeps `z.output`, which is correct there.

For a schema with no `.default()` and no `.transform()` the two types are identical, so most call
sites are unaffected — which is also why this stayed invisible until a schema used them.

**This can surface a real mismatch on upgrade.** A call passing the post-transform value
(`clustered: false`) now fails to compile and wants the wire value (`clustered: 'false'`) — or
nothing at all, letting the default apply. The request was already being serialised to the same
string, so the runtime behaviour was correct; the type was not saying so.
