# ADR 0002 — An abnormal ending is never reported as a normal one

- **Status:** Proposed (2026-08-20)
- **Date:** 2026-08-20
- **Deciders:** program coordinator; requires the project owner's acceptance
- **Blocks:** J3, J5, J6 and J9 of the DX benchmark; M8 (observability) and M14 (build-adapters)

## Context

On 2026-08-20 the DX benchmark measured five of its ten journeys by running the criteria rather than reading them. Four separate defects surfaced, in four different subsystems, written by different hands at different times. They are the same defect:

| Issue | The abnormal ending | What the caller received |
| --- | --- | --- |
| [#379](https://github.com/usetheokit/theokit/issues/379) | The agent loop hit its iteration ceiling with the model still wanting to call tools | An ordinary `done`. The SDK's default ceiling is 8 turns, so this fired for agents that had declared nothing |
| [#384](https://github.com/usetheokit/theokit/issues/384) | The connection dropped mid-stream | `status: 'done'`, `error: null`, and the answer cut mid-word |
| [#382](https://github.com/usetheokit/theokit/issues/382) | The deploy shim buffered the whole response instead of streaming it | A successful response. 659 bytes arrived as one chunk at millisecond 1123 of an 1123 ms run |
| [#388](https://github.com/usetheokit/theokit/issues/388) | A tool exhausted its retries and propagated the last error | `tool-output-available` — the *success* part type — carrying the error text as output, then `done` |

`#388` is worth a second look, because it shows how far the silence can be built in. The SDK reports a failed handler as `{stdout:'', stderr, exitCode: 1}` with `status: "completed"` as a hardcoded literal, so the `status === 'error'` branch the translator was written against is dead code for this SDK — a whole error path that could never execute. And the framework's dedup was correct to call the two reports duplicates: they are the same lifecycle point under the same call id. It simply always dropped the one carrying the exit code, because the report that structurally cannot know arrives first.

None was found by the test suite. Three were found by exercising a journey against real bytes; one by reading the wire beside the equivalent Next.js output, which sends `tool-output-error`.

**Why the suite could not find them.** In every case the code did what its author intended and the tests asserted that intention. A test that asks "did the run finish?" gets `yes` from a truncated run, because the code is the thing deciding what finished means. Five times on the same day, a fixture agreed with the code because both came from the same assumption: token attributes read from an invented flat object; a recorder that dropped the argument the code never passed; a numeric fixture whose only value was `201`, which happens to be an integer; four stream fixtures that ended without a terminal chunk while calling themselves clean turns; and an oracle test that **passed because of** the defect, reading a final message where a ghost part hung.

**Why it matters more here than in a page framework.** A page that fails to render fails visibly. An agent run that stops early returns *text* — plausible, well-formed, and short. The user cannot tell a complete answer from a truncated one, so they act on it. Under this project's own fifth benchmark metric — *when it fails, the error names what to do* — a silent truncation scores worse than a crash, because a crash at least names that something happened.

## Decision

**A code path that ends a unit of work abnormally must say so in the same object that reports the ending. Absence of a reason means, and may only mean, that the work completed.**

Four rules follow.

1. **The reason travels with the terminal event, not beside it.** A consumer reading only the terminal frame must be able to tell the two apart. A log line, a span attribute or a separate channel does not satisfy this — the client deciding whether to retry does not read spans.
2. **Absence means success, so success must be the expensive claim.** Where a producer cannot prove the work completed, it reports the abnormal ending. `#384` settles this shape: the client keys on the `finish` chunk, and its absence is an interruption — rather than keying on `[DONE]`, which the durable encoder flushes from a `finally` even when the source aborted.
3. **A reason is an enum when the reactions differ, a boolean only when they do not.** `#379` chose `stopReason: 'step_limit' | 'no_progress'` because re-sending continues the work in one case and feeds a doom loop in the other; a `truncated: true` would have made a caller do the right thing in one case and the wrong thing in the other.
4. **Transport-level and run-level endings are separate axes and are not collapsed.** `stopReason` says why the run stopped and can only exist when a terminal frame arrived; an interruption is the *absence* of that frame, where the producer never said why. Adding an "interrupted" member to `stopReason` would put a value on a `done` that no producer produced — re-creating the defect inside the field meant to fix it.

## Consequences

**A test asserting "it finished" is not evidence and does not satisfy a criterion.** The obligation is on the test to distinguish, and a fixture that cannot express the abnormal ending cannot fail on it. Every fixture in this class states which ending it encodes.

**Backward compatibility is a floor, not a preference.** A clean run's frames stay byte-identical; the reason key is *absent*, never `undefined`. A consumer that does not know the field is unaffected, and a consumer that does can branch. Both shipped fixes are pinned by an exact-equality assertion on the clean path.

**All four are closed except #382, and that one is the hardest.** The shim buffers because six deploy adapters consume it, and two of those six buffer a second time inside their own emitted contract — so fixing the shim alone leaves those two non-streaming. That one is a contract change across adapters, not a field addition.

**This does not license a new default.** Nothing here changes what a run does; it changes what a run *says*. A ceiling that was always 8 stays 8 — the change is that reaching it is now legible.

## Alternatives considered

**Leave it to the caller to detect.** A caller can compare an answer to a `finishReason`, or time a stream. This is what the framework did, and four subsystems shows it does not hold: the detection has to be reinvented per surface, and every surface that forgets reports success. It also fails the fifth metric outright — the caller learns nothing about what to do.

**One universal `outcome` field for every ending.** Rejected by rule 4. The two axes are genuinely orthogonal, and a single field forces a value where the producer has no knowledge.

**Treat a reached ceiling as an error.** Rejected. A ceiling that is reached is a declared outcome, not a failure; the span status stays `ok`, because marking it error would put every capped run in an operator's error budget and train them to ignore it.
