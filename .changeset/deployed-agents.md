---
'theokit': minor
---

Agents are served on the `cloudflare`, `bun` and `deno-deploy` deploy targets. They were served on
none: every generated entry routed `/api/` through the file-route table alone, so `/api/agents/<name>`
answered 404 everywhere and an agent reached production only on a machine running `theokit start`.

Cloudflare bakes its agent modules as static imports (a Worker has no filesystem); Bun and Deno scan
at request time, the same way they already scan routes. `vercel`, `netlify` and `aws-lambda` receive
a standalone function directory that never sees the app's modules and cannot serve an agent by this
road — every adapter now declares `servesAgents` so the gap is stated rather than assumed.

New subpath `theokit/adapters/agent-mount`, the door generated entries use to reach `mountAgent`.
`theokit/server` still does not export it: ADR 0041's boundary is about what an application may
import, and a generated entry is this framework's own code.
