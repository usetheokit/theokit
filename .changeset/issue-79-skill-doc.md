---
'create-theokit': patch
---

Fix (#79): the shipped `theokit-agents` skill doc taught the wrong `defineAgentTool` signature —
`{ input, execute }` returning an object. The real API (`DefineAgentToolSpec`) is
`{ inputSchema, handler }` where `handler` returns a **string**; a user copying the doc got code
that failed `tsc`. Corrected the example, fixed a stale `@theokit/sdk-tools` tool name in the
"you are here" map (`createSearchTool` → `createSearchTextTool`/`createGlobTool`/`createShellTool`),
and added a regression guard test that asserts the doc's `defineAgentTool` block uses `inputSchema` +
`handler` (fail-closed on future drift).
