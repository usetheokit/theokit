---
"theokit": patch
---

M35 (multimodal) — `streamAgentTurnInProcess` (the in-process agent-turn seam the TUI runs on) now accepts an optional `images` field on its input and threads it to `streamAgentUIMessages`, so an image sent from the composer reaches `agent.send({ text, images })`. Absent ⇒ the string turn is byte-unchanged (back-compat). Requires `@theokit/agents` >= 0.44.5.
