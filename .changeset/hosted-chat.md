---
'theokit': minor
---

`theokit/server/http` adds `createHostedChat`, which mounts a hosted chat page from `{route, createRun, auth, assetsDir, maxBodyBytes, sessionScope}`: the shell with a CSP, named assets, a sandboxed widget frame, an auth gate, a body cap, chat id validation, identity scoping and a relay that stops the run on cancel. TheoClaw's WebChat routes now call it.
