---
'@theokit/agents': minor
---

Add a provider-agnostic `reasoningEffort` knob to enable extended thinking (M1). Set it declaratively via `@Agent({ reasoningEffort })` or per-run via `AgentRunner.run(msg, { reasoningEffort })` (per-run wins over compiled); it maps to the SDK `ModelSelection.params` reasoning slot (`{ id: 'thinking', value: effort }`) at the single `getOrCreate` site, so the provider emits the `thinking` StreamEvents the bridge already forwards. Accepts the common levels (`'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`) plus any provider-specific string. Backward-compatible — with no effort set, the model is sent as a bare `{ id }` (byte-identical to before) and there is no static capability gate (the SDK validates against the model's catalog). New exports: `ReasoningEffort` type and `buildModelSelection` helper.
