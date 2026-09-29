---
'@theokit/agents': patch
---

A flattened SDK error carries its stack for the server logger, so a failing turn names where it failed

`sdkErrorEvent` is the only place the thrown `Error` object is still alive — everything downstream sees
the flattened `{ type, code, message, retryable }` — and it dropped `stack`. So the one field naming
WHERE a turn failed was destroyed at the boundary, and an operator was left with a message.

Measured on a deployed Cloudflare worker, 2026-09-28. A companion fix had just made the masked message
reachable, and the message alone was not enough to act on:

    [theokit] agent turn failed (SDK_ERROR): [unenv] fs.readFile is not implemented yet!

That is a Node builtin refusing on Workers, and `readFile` had six plausible call sites in the
dependency. Without a stack the next step is guessing which one, and a guess costs a deploy per
candidate.

It does not reach the wire. A stack names files, directories and sometimes an argument, which is
exactly what `MASK_ERROR` exists to keep from a browser — so the field is carried for the server
logger, and `errorChunks` constructs each chunk explicitly rather than spreading the event, which
makes that guarantee structural rather than a habit. A non-`Error` carries no `stack` key at all,
rather than the string `undefined` that a template would produce and a log would print as if it meant
something.
