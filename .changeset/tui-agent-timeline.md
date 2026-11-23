---
'create-theokit': patch
---

The `--surface tui` template builds its timeline with `useAgentTimeline` from `@theokit/tui` (now `^0.83.8`) instead of calling `messagesToAgentEvents` itself.
