---
'@theokit/agents': minor
---

`createToolInvokeRoute` now validates `args` against the tool's `inputSchema` by default (`validateAgainstInputSchema`, exported from `./bridge`). Invalid args answer 400 `invalid_args`; a schema that does not compile answers 500 `tool_error`. Pass `validate: false` to restore the old unchecked behaviour, or your own validator to replace the default.

The `zod` peer floor moved from `^4.0.0` to `^4.2.0` because the default validator uses `z.fromJSONSchema`, which first shipped in 4.2.
