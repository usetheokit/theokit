---
"@theokit/presenter": minor
---

Add `ChatPresenter` — the fourth surface, beside `ui-message-stream`, `terminal` and `json`.

The defect it closes was observed on a real phone: a reply arrived as `"TheOi! 👋"`, the `"The"`
being a fragment of the model's reasoning, because a hand-written loop took every frame carrying a
delta. `AgentOutputEvent` is a discriminated union of eight variants and the presenter switches over
it, so the compiler refuses to let a variant be forgotten. The guarantee is structural rather than
disciplinary, which is the whole argument for a presenter on this surface.

It emits exactly ONE message per turn and never splits. A chat surface has no line to rewrite, so
there is nothing to emit until `finish()`; and all eight gateway splitters already split inside
`sendMessage`, so a presenter that pre-split would double-split — a no-op almost always, changing
behaviour only when a chunk lands exactly on the boundary, in production, with no signal from
either side. Length is the adapter's decision and always was.

It knows nothing about any platform. Dialect translation is injected, so `@theokit/presenter` keeps
`dependencies: {}` and the framework acquires no dependency on a gateway package;
`OutboundMessage` is matched structurally for the same reason. `@theokit/gateway` exports
`toDialect(text, platform)` for callers that want the pairing, done at the composition root.

An `error` event becomes a fixed sentence — neither `message` nor `code` reaches the channel, since
both may carry internal detail, and silence on a channel is indistinguishable from an agent that
ignored the person. `tool-call`, `tool-result` and `status` are dropped by default; whether a chat
surface should show them is a product decision, and adding them later breaks nothing.
