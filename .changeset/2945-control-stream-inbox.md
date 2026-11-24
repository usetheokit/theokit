---
'@theokit/agents': patch
---

`@theokit/agents/control` exports `createControlStreamInbox`, an implementation of `ControlStreamInbox`, and `createControlClient` takes `dropAcknowledgements` to omit `interrupt_ok`, `steer_ok` and `no_turn` from `chat()`.
