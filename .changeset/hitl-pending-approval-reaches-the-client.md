---
'@theokit/presenter': patch
'@theokit/agents': patch
'theokit': patch
---

A web application can now render a human-in-the-loop approval prompt. `useAgent` returns
`pendingApprovals` — one entry per decision the run is parked on, carrying the `approvalId` that
`approve()` takes, the gated tool's name, the arguments it is about to run with, the question
declared on the gate, and the window before it settles itself.

Before this the hook exposed the settle half of the gate and no way to reach the other half. The
store dropped the `tool-approval-request` frame on the way in, so its whole snapshot while a human
was deciding was `messages`, `thread`, `status: 'streaming'` and `error` — and the paused tool sat in
`state: 'input-available'`, which is exactly what an ungated tool looks like while it runs. An
application could not tell "working" from "waiting for you", and could not have named the decision if
it could. The only path left was polling `GET /api/agents/<name>/approvals` out of band.

The transcript carries it too: the gated call's own part moves to `state: 'approval-requested'` with
the id under `approval.id` while the decision is outstanding, and leaves that state when it is
settled. That is the ai-sdk reader's own vocabulary, not a new one — the differential oracle compares
the two readers on the paused run and the denied run and they reconstruct identically.

What the gate is asking travels as a transient `data-approval` part rather than on the approval frame
itself. The frame is shared vocabulary and `ai`'s validator for it is strict: a `question` added
there would not give an ai-sdk client a poorer prompt, it would delete the whole approval frame for
that client and re-create this defect on the other side of the wire. The tool's name and its
resolved input are not repeated anywhere — the `tool-input-available` frame already announces both
under the same call id, and both readers fold the frames into one part.

`approve(approvalId, decision)` is unchanged; what changes is that the store now hands the id over.
A tool with no gate produces exactly the same frames and exactly the same snapshot as before, with
`pendingApprovals` empty.
