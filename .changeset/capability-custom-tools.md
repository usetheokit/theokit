---
'@theokit/agents': minor
---

`ToolsCapability` now accepts the SDK `CustomTool` as well as `CompiledTool`, and `shapeToolsAsCustomTools(shape)` returns a shape's tools as `readonly CustomTool[]`, so composing an agent from capabilities needs no casts. `CompiledTool.inputSchema` stays `unknown` (decorator tools may hold a live Zod schema), so the helper is used instead of narrowing it.
