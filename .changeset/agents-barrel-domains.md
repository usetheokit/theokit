---
'@theokit/agents': minor
---

Pass-through barrels for the 5 already-OO / pure SDK domains (M58).

The layered boundary `SDK → Theokit → AgentBuilder`: `@theokit/agents` now re-exports the SDK domains
that are already object-oriented or pure helpers, so a consumer imports them from the Theokit layer
instead of `@theokit/sdk*` directly. Re-export, never a wrapper (parsimony Rung 9) — wrapping
`Agent.create()` or a pure `transcriptPath()` would be ceremony without value.

- **core** (main barrel): `Agent`, `Squad`, `Tool`, `Provider` + `SDKAgent` / `CustomTool` /
  `SessionRecord` types.
- **`@theokit/agents/sandbox`**: `LocalSandbox`, `SandboxBackend`, `SandboxConfig`.
- **`@theokit/agents/persistence`**: `transcriptPath`, `encodeProjectDir`, `atomicWriteText`,
  `SessionRecord`.
- **`@theokit/agents/interactive`**: `InteractiveBackend`, `StartInteractiveOptions`,
  `StartInteractiveResult`.
- **`@theokit/agents/pty`**: `PtyInteractiveBackend` (optional peer `@theokit/sdk-pty` — only consumers
  of this subpath need it installed).

A surface test locks each barrel's symbols so a dropped re-export fails loudly. The `@theokit/sdk`
peer range moves to `^4.19.0` — the `/interactive` and `/sandbox` subpaths this layer re-exports live
there. Consumers already on SDK 4.19+ are unaffected.
