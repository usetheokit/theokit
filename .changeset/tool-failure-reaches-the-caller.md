---
'@theokit/agents': patch
---

A tool that failed reaches the caller as a tool that failed.

A tool whose handler threw — including one that threw on every attempt until its retries ran out —
crossed the wire as `tool-output-available`, the SUCCESS part of the UIMessage protocol, with the
error message sitting in the field a UI renders as the tool's answer, on a run that terminated with
an ordinary `done`. Nothing on the wire told a failed call from a call that worked, so a consumer
watching for a failure never fired, and a UI printed the failure as the result.

The failure signal was in hand the whole time. `@theokit/sdk` catches whatever a handler throws and
reports the call with `{stdout, stderr, exitCode}` — a non-zero code for a throw, a hook block, a
human denial, a timeout or an unknown tool — under `status: 'completed'`, which is the SDK's word
for "the call is over", not for "the call worked". Both translation sites read the status and
hardcoded `isError: false`, and the timeline dedup then dropped the only report carrying the exit
code as a duplicate of the report that structurally cannot carry one: the completion delta's payload
is a rendered string, and the message carrying the code always arrives second.

The exit code now travels. A failed call reaches the wire as `tool-output-error` with the message in
`errorText` — the presenter branch that emits it already existed and was never reachable from a
served run. A completion is held for one report rather than emitted immediately, so the second report
can contribute its exit code to the first instead of being discarded; exactly one result per call
still reaches the wire, and one that ends the run is flushed rather than held forever.

A call that succeeded is unchanged, chunk for chunk: it emits `tool-output-available` with the same
rendered output, under the same id, exactly once. A completion nobody reported an exit code for is
not called a failure — the `[stderr]` prefix in the rendered text is a string convention, and
classifying failures by matching error text is a mistake this codebase has already paid for once.
