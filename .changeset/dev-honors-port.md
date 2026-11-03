---
'theokit': patch
---

`theokit dev` reads `PORT`, with the same precedence `theokit start` has: `--port`, then `PORT`, then `port` in `theo.config.ts`. It listened on `config.port` whatever `PORT` said, so a script or container that set `PORT` for both commands got it from only one of them. Both commands now resolve the port through one function (#1134).
