---
'@theokit/host': minor
---

Add `@theokit/host/app-host`: `createAppHost` starts an agent app's services in order, stops the started ones in reverse when a start fails, and tears them down once on `close()` or on SIGINT/SIGTERM. A failed start rejects with `AppHostStartError`.
