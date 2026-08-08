---
'@theokit/agents': minor
---

`ToolsetError` now extends `TheokitAgentError` instead of `Error`.

It sat outside the SDK's error hierarchy, so `catch (e) { if (e instanceof TheokitAgentError) }` —
the shape consumers use to tell an SDK failure from any other throw — missed it, leaving name or
message matching as the only way to recognise it. A consumer reported writing a `translateError()`
shim for precisely that.

This layer had already settled the same argument in M61, when two `ConfigurationError` classes (one
`extends Error`, one `extends TheokitAgentError`) made an `instanceof` check catch one path and
silently miss the other. Same defect, same package, simply left standing here.

`code` remains a public readonly field and `name` is unchanged, so existing
`new ToolsetError(msg, 'unknown_tool')` calls and `err.code` reads keep working. It is still
`instanceof Error`, via `TheokitAgentError`.
