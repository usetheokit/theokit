---
"@theokit/agents": patch
---

`@theokit/agents` code mode now reports the failures it used to drop. `createQuickJsSandbox` keeps its default for an option passed as `undefined`, and refuses a limit that cannot bound a run (a `timeoutMs` or `memoryLimitBytes` that is not a finite number above 0, a `maxCalls` that is not an integer of at least 0) when the sandbox is built, with the new `CodeModeSandboxConfigError` (`code: 'CODE_MODE_SANDBOX_CONFIG'`) exported from `@theokit/agents/code-mode-quickjs`. A run now waits up to 250 ms, after aborting them, for the host calls it started. A script that starts a host call it does not await, against a tool that ignores the abort, now fails with the new `CodeModeSandboxError` code `host_call_unsettled` instead of returning while the call still runs. (B-697)
