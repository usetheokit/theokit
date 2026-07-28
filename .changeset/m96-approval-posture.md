---
"@theokit/agents": major
---

**BREAKING:** `toAgentFactory` now requires an `approvals` option declaring the surface's `ApprovalPosture` — one of `interactive`, `auto-approve`, `auto-reject` or `owned-by-surface`.

Until now the factory compiled the HITL gate map that `.approvals({…})` produces and then discarded it, so tools declared as requiring approval executed with no policy consulted — while the sibling bridge (`streamAgentTurnInProcess`) refused for the same definition. The permissive behaviour is still fully available; it just has to be named, with a written reason, instead of happening by omission. Migration is one line per call site: pass the posture that describes what your surface actually does.

`streamAgentTurnInProcess` also accepts `approvals`, but additively — omitting it preserves today's fail-closed refusal exactly.
