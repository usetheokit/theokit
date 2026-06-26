---
"@theokit/agents": minor
---

V4-Q: `AgentRunner` accepts pre-built SDK `CustomTool[]` via `run-options.sdkTools`.

`AgentRunnerRunOptions.sdkTools?: readonly CustomTool[]` (and `RuntimeOverrides.sdkTools`) forwards already-built SDK tools RAW to `Agent.create.tools`, appended after the `@Tool`-compiled tools, bypassing `defineTool` (which requires a Zod schema). Lets an app whose tools come from imperative SDK factories (`@theokit/sdk-tools` → `CustomTool[]`, JSON-Schema `inputSchema`, no recoverable Zod) adopt `AgentRunner.stream()` — closes the last tool-sourcing gap the theocode loop-adoption discover found. Additive + backward-compatible: absent ⇒ the compiled-tools path is byte-identical; distinct from `tools` (which REPLACES the compiled set). No new dependency (Rule 9).
