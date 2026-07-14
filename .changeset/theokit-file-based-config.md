---
"@theokit/agents": minor
"theokit": minor
---

Opt into `.theokit/` file-based config with `.settingSources([...])`.

A code-created agent can now discover its skills, subagents, hooks, MCP servers, context, and cron jobs from files under `.theokit/` — config-as-git. Add `.settingSources(['project'])` to the `agent()` builder and the framework wires the SDK's `local.settingSources` + the app-root `cwd`, so the SDK discovers `<cwd>/.theokit/` (and `~/.theokit/` with `'user'`).

```ts
export default agent()
  .model('openai/gpt-4o-mini')
  .system(BASE_INSTRUCTIONS)
  .settingSources(['project']) // ← discover .theokit/ from the app root
  .build()
```

- `.settingSources([...])` is an Axis-A "SWAP" value (per the `agent-dynamic-config` blueprint): an explicit, non-empty list wins; `[]` is treated as unset; an agent that declares inline `.skills()` still falls back to `['project']` (back-compat). Discovery is now **decoupled from inline skills** — an agent can use `.theokit/hooks.json` / `mcp.json` / subagents / context with no inline skill.
- The app-root `cwd` is the **framework-resolved project root** threaded through `mountAgent`, NOT `process.cwd()` (which is not guaranteed to be the app root) — so discovery reliably points at `<app>/.theokit/`.
- The SDK owns discovery + execution (skill loading, hook shell execution, MCP launch); theokit only wires `local.settingSources` + `cwd` (G2 / ADR-0040 — no runtime reimplementation).
- **Security:** enabling `'project'` enables shell-executing hooks from `.theokit/hooks.json`. This is opt-in because `.theokit/` is your own repo (informed consent).

Verified end-to-end in a real browser: a showcase agent with `.settingSources(['project'])` discovered a `.theokit/skills/` skill and listed it alongside its inline skill.
