---
'theokit': patch
---

A route handler's `ctx.request` carries the body it arrived with.

`incomingMessageToHandlerRequest` built the handler's `Request` from method and headers only —
deliberately, since #117 moved the parsed value onto `ctx.body`. The consequence was not foreseen:
any API that takes a `Request` and reads it gets an empty stream, and `request.bodyUsed` is `false`,
so nothing signals why.

`handleChannelWebhook` is exactly such an API, and this framework publishes it as the supported way
to receive from Telegram, Slack, Discord and the rest. Called from a route — the only way a TheoKit
app defines an HTTP endpoint — it answered `400 Request body must be JSON` for every request,
including ones whose body was valid JSON. The channel-webhook seam could not be wired at all.

The parser now keeps the raw bytes of a JSON body and the handler's `Request` is built over them.
The RAW bytes, not the parsed value re-serialised: every platform that signs a webhook computes its
HMAC over what it sent, and `JSON.stringify(JSON.parse(x))` moves key order, whitespace and number
formatting — a reconstruction would verify against nothing.

Multipart is unchanged: its parsed `fields`/`files` are the interface and the raw form has no second
consumer.
