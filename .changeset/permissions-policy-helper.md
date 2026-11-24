---
'@theokit/agents': patch
---

`onAskForPolicy(policy, gated, { refusal })` answers the `ask` verdict of `createPermissionsPlugin`: `never` allows, a gated tool is passed to its approval gate, any other tool is denied with a message that names the two ways out.
