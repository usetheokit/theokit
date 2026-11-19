---
'@theokit/agents': minor
---

`bindToolScope` accepts `protectedPaths`, and `@theokit/agents/tool-scope` exports `createPathVetoPlugin` and `vetoPathCall`, a symlink-safe `pre_tool_call` veto for those paths, with `resolveRealPath`, `isWithin` and `SymlinkLoopError`.
