---
"theokit": patch
"@theokit/agents": patch
"create-theokit": patch
---

M6 dogfood fixes — two real V1 bugs surfaced by a live `npx create-theokit` run.

- **Tool calls crashed** (`TypeError: ... reading 'def'`): `buildSdkTools` re-ran `defineAgentTool`'s
  already-lowered JSON-Schema tool through the SDK's `defineTool` (which expects a live Zod schema).
  It now routes by `inputSchema` shape — Zod schema → `defineTool`; already-SDK-ready `CustomTool`
  (JSON-Schema `inputSchema`) → forwarded raw. Regression test + confirmed minimal repro.
- **Fresh scaffold failed to start** (`ERR_PACKAGE_PATH_NOT_EXPORTED` on `@theokit/sdk/compaction`):
  the default template pinned `@theokit/sdk@^1.1.0`, below the `@theokit/agents@0.30.0` peer floor
  (`>= 2.13.0`). Bumped the template + fixture pins to `^2.13.0`.
