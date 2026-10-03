---
"theokit": patch
---

The client entry turns on zod's `jitless` mode before the app renders

zod v4 probes for `eval` with `new Function("")` the first time it parses an object schema. The
default CSP refuses it, zod falls back to its jitless path, and the browser still files a
`script-src` violation report on every page load, burying real violations in `/__theo/csp-report`.
The generated client entry now calls `config({ jitless: true })` from `zod`, a required peer, so
the page chunk's zod never probes. An app that allows `'unsafe-eval'` in its own CSP loses zod's
compiled object parsing in the browser; the server is unaffected. (#937)
