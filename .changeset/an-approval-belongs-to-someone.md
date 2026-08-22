---
'theokit': minor
---

An approval belongs to someone, and only they can settle it.

The HITL ledger keyed approvals by a bare id and recorded no owner. The agent's policy could answer
*"may this subject touch this agent's approvals"* and never *"is this approval theirs"*, so an
authenticated tenant could settle another tenant's approval on an agent both were admitted to — the
policy was the only thing between them, and it cannot see whose approval it is. The gap was
documented in `agent-access.ts` as real and open; this closes it within a stated scope.

`mountAgent` now records the run's subject on each approval it registers, and the approve endpoint
refuses a caller whose identity does not match. A caller who cannot be identified at all is refused
too: an approval that has an owner must not be settleable by whoever reaches the endpoint without an
identity, or the guarantee would depend on how the host wired its resolver rather than on who is
asking.

**The check only ever narrows, and two paths are deliberately untouched.** An agent that declares
`'public'` records no owner — attributing its approvals would start refusing callers the declaration
admits, which is a behaviour change dressed as a bug fix. And a thread continuation runs headless,
with no request whose identity could be resolved, so its approvals record nobody. In both cases the
endpoint behaves exactly as before, and `params.approvalId` is still passed to the policy so an
application holding its own owner map can answer more than the framework does.

Owner ids are not exposed through the pending-approval listing: that listing feeds a UI, and who
else is waiting on an agent is identity rather than status.

`ApprovalRegistry` gains `ownerOf(approvalId)`. A custom implementation of that interface must add
it.
