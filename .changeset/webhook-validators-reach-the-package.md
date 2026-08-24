---
'theokit': patch
---

The webhook signature validators are reachable from the package.

`handleChannelWebhook(request, path, { validators, onMessage })` takes a REQUIRED `validators` map,
and its own docblock demonstrates `{ slack: slack({...}), telegram: telegram({...}) }` — while
`server/webhook` re-exported none of the six providers sitting beside it. Nothing shipped: the
published bundle carried no `providers/` file, and the string `x-telegram-bot-api-secret-token`
appeared nowhere in `dist/`.

So the channel-webhook seam could not be wired by a consumer at all: the parameter was required and
no value for it existed. The framework's own test imports the providers by relative source path,
which is why nothing noticed — it proves the function works and says nothing about whether anyone
can call it.

`discord`, `github`, `slack`, `stripe` and `telegram` are now exported from `theokit/server/webhook`
with their options types, covered by a test that failed with `expected 'undefined' to be 'function'`
before the change. Found while writing the `theokit-gateways` scaffold skill and failing to write
its example (theokit-gateways B-011).
