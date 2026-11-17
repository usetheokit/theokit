---
'theokit': minor
---

Add `theokit/testing` with `startTestServer`, which boots the app's own `theokit dev` or `theokit start` on a free port for an app's end-to-end tests, and `TestServerBootError`.

`startTestServer` also checks that the child, not another process, owns the port it was given: on Linux from `/proc`, on macOS with `lsof` and on Windows with `netstat`. A substituted port is retried on another one, and if ownership cannot be established the boot fails with the reason instead of accepting the server.
