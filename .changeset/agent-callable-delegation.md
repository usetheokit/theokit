---
'@theokit/agents': minor
---

`createDelegateTool` — the agent can now ask the framework to delegate.

`@theokit/agents/tools` handed the model 23 tools and none of them delegated to a local sub-agent.
The capability shipped — `delegate()`, `delegateWithScoring()`, `delegateBackground()`, `Squad` —
but only the app could reach it. `createA2ATool` did not cover the case: its target is a remote peer,
inheriting none of the parent's tools, budget or authority.

The factory is deliberately thin. `delegate()` already merges the parent's tools, clamps the budget
and propagates authority; re-deriving any of that here would create a second owner of one rule.

It refuses at construction what would otherwise fail on the model's first call: an empty roster,
duplicate names (which collapse in the enum and dispatch silently to the wrong sub-agent) and a
missing credential. Budget and timeout failures come back as JSON the model can act on rather than
ending the parent's turn; an unexpected error propagates.
