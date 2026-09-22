---
"theokit": minor
---

`server/context` and `server/middleware` are now found as `.ts`, `.tsx`, `.js` or `.jsx` — the same extensions an agent may carry. They were resolved as `.ts` only.

The consequence for a JavaScript project was silent and pointed the wrong way: its agents were found, because `scanAgents` already accepted four extensions, while its `server/context.js` was not. `createServerContext` returned `{}`, every policy saw `subject: null`, and that is indistinguishable from a caller who sent no credential — so a project whose identity resolution simply was not being loaded looked like a project whose callers were all anonymous.

`.ts` is tried first, so a project holding both keeps resolving exactly what it resolved before.
