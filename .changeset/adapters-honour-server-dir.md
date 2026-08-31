---
'theokit': patch
---

Deploy adapters emit the project's configured `serverDir` instead of the literal `server`.

`bun`, `cloudflare`, `vercel` and `aws-lambda` each generated an entrypoint containing
`resolve(cwd, 'server')` while receiving the full config as an argument — the value was in hand and
unused. Any project that set `serverDir` (the entire point of the option) got a bundle resolving a
directory that is not there, and only found out after deploy: the build succeeds, the artifact is
written, and routes 404 in production with nothing in the log naming the cause.

The directory is now emitted through one shared helper that quotes it with `JSON.stringify`, so a
path containing a space, a quote or a backslash cannot turn a generated file into a syntax error in
someone else's build. Projects that never set the option are unaffected — the fallback is still
`server`.
