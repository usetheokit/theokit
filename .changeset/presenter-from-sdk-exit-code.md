---
'@theokit/presenter': patch
---

`fromSdkMessage` now reports a tool call with a non-zero `result.exitCode` (failed, timed out, vetoed, unknown tool) as `isError: true`, matching `@theokit/agents`. It used to read only `status`, which the SDK sets to `completed` for every finished call.
