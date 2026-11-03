---
'@theokit/agents': minor
---

`@theokit/agents/sandbox` re-exports `shellEscapePosix` and the `SandboxNetworkPolicy` type, and `SandboxBackend` now carries an optional `dispose()` and an optional `networkPolicy`. A backend for a VM or a container can stop what it holds and state what it can reach (`LocalSandbox` says `unrestricted`), and code that builds a command line outside a backend subclass can quote an argument. The layer requires `@theokit/sdk` ^5.13.0, the release that adds them; on an older SDK the re-export of `shellEscapePosix` would not resolve (#1130, #1131).
