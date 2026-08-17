---
"@theokit/agents": minor
---

Security: `auto-edit` no longer auto-approves from a framework-chosen default. A product declares its own set.

`shouldAutoApprove`'s `auto-edit` branch defaulted to `WRITE_SCOPED_TOOLS` — `apply_patch`, `edit_file`, `write_file`. The only real consumer auto-approves one of those and registers two, so adopting the framework symbol would have made `edit_file` stop requiring a human: a live, model-callable write tool, silently un-gated as a side effect of deleting duplicated code.

Two questions had been conflated. "Does this tool bound its own writes to a write root?" is a fact about the SDK's tool factories, and the framework can answer it. "May this tool run without asking a human?" is the product's policy, and the framework cannot answer it — it does not know which tools the product registered or what it renamed them to.

`auto-edit` with no `writeScopedTools` now approves nothing, which is the same shape the module already applies to sandbox posture (an absent posture counts as unconfined). `WRITE_SCOPED_TOOLS` is still exported as the catalog; passing it is a decision rather than an inheritance.

`WRITE_SCOPED_TOOLS` is now genuinely immutable — its mutators throw. `ReadonlySet` is erased at runtime, and one cast on an approval gate reachable from every consumer would widen what auto-approves everywhere. `Object.freeze` alone is not enough for a `Set`: entries live in internal slots, not own properties, so freezing leaves `add` working.

Not a breaking change for published consumers: `npm pack @theokit/agents@9.4.0` exports neither `shouldAutoApprove` nor `WRITE_SCOPED_TOOLS`. Anyone already calling it on a pre-release build must pass `{ writeScopedTools }` to keep `auto-edit` approving anything.
