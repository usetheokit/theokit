---
"theoclaw": minor
---

`theoclaw proxy validate` checks that the operator's HTTPS proxy is reachable, and `theoclaw proxy start` runs a local capture proxy; a process started with `THEOCLAW_DEBUG_PROXY_URL` (or `THEOCLAW_PROXY_URL`) routes its requests through it, and `theoclaw proxy sessions` lists them. (#1571)
