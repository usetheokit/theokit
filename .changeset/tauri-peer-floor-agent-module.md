---
'@theokit/tauri': patch
---

Raise the `theokit` peer floor to `>=0.65.0`. `@theokit/tauri/sidecar` imports `AgentModule` from `theokit/server/agent`, which `0.65.0-next.0` does not export, so the declared floor could not build.
