---
"@theokit/agents": patch
---

M35 (multimodal) — thread images through the bridge to `agent.send`. `StreamAgentOptions` and `RuntimeOverrides` gain an optional `images` field; when present the adapter sends the SDK's structured `SDKUserMessage { text, images }` form instead of a plain string, so the model receives images alongside the text. Absent ⇒ the string send path is byte-unchanged (back-compat). Zero new dependencies.
