---
"@theokit/agents": minor
---

`@theokit/agents/tools` now forwards the image tool, and the `@theokit/sdk-tools` floor moves to
`^0.27.1` to make that possible.

Three symbols reach the layer for the first time: `createViewImageTool`, `CreateViewImageToolOptions`
and `DEFAULT_MAX_IMAGE_BYTES`. `view_image` lets an agent LOOK at an image in the project — read the
bytes, confine the path, and hand the model an image block rather than a base64 blob it cannot see.

This is a gap closing rather than a feature arriving. `tools-entry.ts` states that the surface is
preserved WHOLE and that any deliberately withheld symbol carries its reason in writing; these three
were absent with no reason, because the pinned `^0.26.1` did not publish them. The layer was not
withholding anything — its dependency was short. The cost was measurable: `view_image` was the only
tool a consumer had to write by hand, in a registry where the other nine were built-ins, and an image
reader that honours any path is a file-exfiltration primitive with a friendly name — exactly the code
that should not be rewritten per product.

`tests/unit/tools-view-image-parity.test.ts` had been skipping loudly for this reason and turned
itself back on the moment the floor moved. Its two behavioural assertions were rewritten to observe
`handler` rather than `toModelOutput`: `Tool.create` consumes the shaping it is given, so the
returned tool carries `name`, `description`, `inputSchema` and `handler` and nothing else — which the
source states in its own header. The behaviour they pin is unchanged and now actually measured: a
readable image reaches the model as exactly ONE image block with no leading text, and a failed read
stays a text envelope so the model can read the error and retry.
