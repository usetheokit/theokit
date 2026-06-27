---
"@theokit/agents": minor
---

`AgentRunnerRunOptions.plugins` now also accepts a `readonly Plugin[]` (an array of code Plugin objects), not only `PluginsSettings` ({ enabled }). Mirrors the @theokit/sdk `AgentOptions.plugins` widen — the runtime already forwards plugin arrays. Lets consumers pass `plugins: [permissionPlugin, cachePlugin]` without an `as unknown as` cast.
