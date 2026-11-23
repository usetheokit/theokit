---
'@theokit/agents': minor
---

`@theokit/agents/control` exports `createControlStreamSource`, which turns a control client, a session and a message into a stream source for a TUI's `useAgentStream` with the session's `interrupt` and `steer`, and `createControlFrameConverter`, the frame-to-event conversion it uses.
