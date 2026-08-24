---
'theokit': minor
---

The exported `agent.run` span records the model the run used, as `gen_ai.request.model` — the
attribute name OpenTelemetry's GenAI semantic conventions give it. Token counts alone convert to no
cost, because price is per model, so a run whose provider reported no cost was unpriceable from its
own trace. The value is the model that actually ran, resolved where a per-run override wins over the
declared one and an agent that declared none reports the default it fell back to, and it travels on
the turn's `finish` metadata — so Tauri and terminal surfaces receive it over the same path the web
does. A producer that reports no model records no attribute rather than a guess.
