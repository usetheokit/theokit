---
'theokit': minor
---

Two issues I had closed as "not fixable from this side". Both were fixable; I had stopped measuring
too early.

**An SDK builtin provider is now reachable (#579).** An app calling `.plugins(Provider.builtins())`
and then `.model('openai-chatgpt/gpt-5.4')` got a 500: *"declares provider `openai-chatgpt`, which
is not registered"*. The refusal itself is right — #503 made an unregistered prefix a refusal so a
turn could not silently succeed against a provider nobody named — but it consulted only this
project's four-entry literal, and `registerProvider` is called nowhere in the product. The SDK ships
44 builtins and a `Provider.forModel(modelId)` whose own docblock names the theokit agent server as
the runtime that "does NOT share this registry". The seam was declared on one side and consumed on
neither. The resolver now asks the SDK **after** its own registry misses, so a declared entry keeps
its own env key, priority and `baseUrl`. A profile naming no env var (Codex authenticates by OAuth,
refreshed per request inside the profile's own transform) resolves keyless, the same class the
`ollama` entry has occupied since #407. A prefix neither source knows is still refused.

**Durable memory no longer lands wherever the process was started (#557, partial).** At the declared
floor (`@theokit/sdk@^4.52.1`) the memory root is `resolve(memoryDir(opts.cwd))`, and `mount-agent`
passed a `cwd` only when the agent opted into file-based config — while `resolveDiscoveryCwd`'s own
docblock records that `process.cwd()` "is not guaranteed to be the app root". An agent with memory
enabled now names the resolved app root, so the location stops depending on where the operator
happened to `cd`. This does **not** relocate memory on SDK >= 4.61, where the root is derived from
`local.baseDir` — one field governing both the transcript and the memory, tracked as
`usetheokit/theokit-sdk#463`.
