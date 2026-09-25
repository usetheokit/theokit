# B-273 widened its own scope, and four of its acceptance criteria are withdrawn

- **Date:** 2026-09-24
- **Status:** accepted
- **Item:** B-273, `the-probes-own-control-is-untestable`
- **Found by:** the cross-validation and architecture reviewers of the REVIEW gate, independently

Two decisions, both mine, both taken during execution and neither recorded until this file. Writing
them down after the fact is worth less than writing them down before, and that difference is the
finding.

## 1 — The timeout was out of scope and was added anyway

The plan reasoned about this exact change and decided against it. `§ Failure scenarios`, verbatim:

> | the ingest endpoint | answers slowly / hangs | **not reproduced** | today the guard has no
> timeout, so it waits as long as `fetch` does. **Named rather than fixed: adding a timeout is a
> behaviour change to B-199's instrument and belongs to its own item** |

and, one paragraph on: *"it is **out of this item's scope** because the fix changes the probe rather
than exposing it."* `grep -ic abortsignal` over the plan returns **0**.

`c6fbd6400` added `AbortSignal.timeout` to the guard. `autonomy-envelope.md § Scope grew during
measurement` is explicit: *"Register the excess as new items, leave the original at its recorded
scope, and link them. **Never widen an item that is already executing.**"* I did not.

**What I did instead, and why it is not a defence.** A `loop-code-review` audit measured the guard
still pending at 8081 ms against a host that accepts the connection and never answers, and I fixed
what the measurement showed without asking whether the plan had already answered the question. The
measurement was real and the fix is right — two reviewers reproduced it independently. The plan had
reasoned about it first, and I did not read that far before acting.

**Why it is not reverted.** `c6fbd6400` is on the remote and shared history is not rewritten
(`git-safety.md`). Reverting the behaviour would restore a guard that hangs forever on a silent host,
which is worse than an unplanned fix. The honest cost is recorded rather than removed: **the plan's
§ Failure scenarios now contradicts the code**, and a reader who trusts the plan will believe there
is no timeout.

**What follows from it.** The timeout's own consequence — one message for four causes, naming a
cause it had not observed — was raised as HIGH by two reviewers and is fixed in the same breath,
because shipping a diagnostic that lies is what this whole item exists to stop. That fix widens the
scope further, and this ADR is what carries the decision rather than a commit message nobody greps.

## 2 — AC-008, AC-009, AC-010 and AC-012 are withdrawn as criteria

| AC | What it demands | HEAD | Kind |
|---|---|---|---|
| AC-008 | `vitest list \| grep -c " > "` prints **3** | 12 | a census of the work |
| AC-009 | the guard ≤ **30** total lines | 40 | a line budget |
| AC-010 | the probe ≤ **115** total lines | 122 | a line budget |
| AC-012 | the test file ≤ **60** total lines | 171 | a line budget |

All four measure **how the work looks**, not what anyone observes. `CLAUDE.md § 3.1` — written on
this same day, hours before this plan was executed — names line budgets as an acceptance-criteria
anti-pattern in those words, on measured evidence: six of six refusals in an earlier review were on
process-artefact criteria, and zero behavioural criteria were ever refused.

**AC-008 is the sharpest and it is worth stating alone.** Meeting it today requires **deleting** the
cases that kill four mutants — two of which failed OPEN, approving the exact receiver the guard
exists to reject. A criterion that a suite fails by getting better is Goodhart at its purest, and it
is the reason § 3.1 exists.

**So the criteria are withdrawn, not met.** The nine behavioural criteria — AC-001 through AC-007,
AC-011, AC-013 — pass and are the item's real contract. The Global DoD bullet *"All 13 acceptance
criteria of the alignment brief pass"* is **false at HEAD and stays false**; it is superseded by this
ADR rather than quietly reinterpreted.

**What was rejected.** Editing the plan to relax the four numbers: the panel record binds the plan by
sha256 (`check_panel_approval.py`), so editing it after 2-of-3 approval would mark the approval STALE
— *"the cheapest way to launder a rewrite past a panel"*, in that checker's own words. An ADR beside
the plan is the honest instrument and this is it.

## What this costs, stated rather than implied

Two documents now disagree with the tree and are not being corrected, because correcting them would
falsify what was approved: the plan's § Failure scenarios (no timeout) and its four withdrawn
criteria. A reader of the plan alone gets the wrong picture. A reader of the plan plus this file gets
the right one, and nothing forces them to read both — which is precisely the weakness of an ADR
written after the fact, and the reason the doctrine asks for the item to be registered BEFORE the
scope moves.

## Related

- The scope rule: `rules/autonomy-envelope.md` § Scope grew during measurement
- The criteria rule: `CLAUDE.md` § 3.1 "Seja Claro Como Água"
- Why the plan may not be edited: `mechanisms/gates/check_panel_approval.py`
- The record of each round: `.squad/records/implementations/the-probes-own-control-is-untestable-implementation.md`
