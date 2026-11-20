---
'@theokit/agents': minor
---

`createCodeMode` takes `plugins` and `hookContext`: the `pre_tool_call` hooks of those plugins run before each tool call a script makes, after `onPermissionRequest`. A block refuses the call with its message, and a hook that throws refuses it too.
