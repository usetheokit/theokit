---
'theokit': patch
---

`serialization: 'superjson'` now applies on the six Web-standards deploy targets (vercel,
cloudflare, netlify, bun, deno-deploy, aws-lambda). The generated entry carried no transformer, so a
deployed app fell back to `JSON.stringify` and never emitted `x-theo-transformer` — serialising one
way locally and another in production without telling the client. The entry now resolves the
selector through the same `resolveTransformer` the local server uses. `config.plugins` remains
declared as unapplied on those targets: it holds constructed objects, which no literal can express.
