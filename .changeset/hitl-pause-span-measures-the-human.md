---
'theokit': minor
---

The HITL pause span measures the human's wait, not the human plus the model.

`agent.hitl` was ended when the gated tool produced output, on the premise — stated in the code —
that "the tool producing output IS the resume". The wire refuted it: with the approval answered at
~3306 ms, that chunk arrived at 4829 ms, and across three runs varying only the model's post-resume
latency the excess tracked it 1:1 (20 ms → +30 ms, 700 ms → +723 ms, 1500 ms → +1524 ms). The
premise holds only when the model is instantaneous, which is the one case nobody deploys.

The resume happens on a different HTTP request — the approve endpoint — which the run's observer
never sees. The span handle now lives in a registry keyed by approval id that both reach, and the
approve endpoint closes it at the instant the answer arrives, so the duration is the human's by
construction rather than by subtraction.

Closing is idempotent because the registry drops the handle: the tool result arriving seconds later
cannot re-close a span the approval already ended, which would have reintroduced the defect through
the fallback path. That fallback still runs for transports that settle an approval without an
approve request — the terminal prompt among them — so their behaviour is unchanged.

In-process, like the approval registry it shadows: the handle is a live object, so pause and resume
must be in one process. A multi-instance deploy resumes on whichever instance the approve request
reaches, and elsewhere the span falls through to the end-of-run sweep and is marked
`hitl.resume_observed=false` rather than reporting a duration it did not measure.
