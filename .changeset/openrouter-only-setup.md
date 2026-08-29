---
'create-theokit': patch
'theokit': patch
---

An OpenRouter-only setup runs the scaffold out of the box.

A fresh app given only the key `.env.example` asks for answered 500 on its first message. The
generated agent declared `openai/gpt-4o-mini`; the first segment of a model id selects the provider,
so that id needs `OPENAI_API_KEY` — the one key the user was never told to get. The scaffold's own
docblock promised the opposite, that the prefix let OpenRouter route the model upstream.

Measured against `@theokit/sdk`'s provider catalog, it does not: `openai/gpt-4o-mini` resolves to
`api.openai.com`, and only `openrouter/openai/gpt-4o-mini` resolves to `openrouter.ai`. The gateway
has to be named in the id.

So the scaffold declares `openrouter/openai/gpt-4o-mini`, matching the key it asks for, and its docs
say what the prefix actually does. A test in `create-theokit` now pins the invariant: the key
`.env.example` leaves uncommented must be the key the declared models need.

The resolver still refuses rather than substituting a credential it happens to find — every caller
takes its `apiKey` and discards its `baseUrl`, so a substituted key reaches whatever endpoint the
model id names, which is the unattributable `401` of #326. What changed is that the refusal is now
actionable: when a credentialed gateway could serve the model, the message names the exact
gateway-prefixed id instead of only the variable that is missing.
