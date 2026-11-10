---
'@theokit/agents': minor
'theokit': patch
'create-theokit': patch
---

The `@theokit/sdk` floor is now 5.15.1, in `@theokit/agents`, `theokit` and the `create-theokit` template. 5.15.1 recovers several Gemini `<ctrl42>call` calls under one marker and keeps that text out of `text_delta` while streaming. `@theokit/agents/persistence` now re-exports `SqliteSessionStore` and `SqliteSessionStoreOptions`, and `@theokit/agents/sandbox` re-exports `DockerSandbox`, `DockerRunner`, `DockerRunResult` and `DockerSandboxConfig`, which the SDK added in 5.15.0.
