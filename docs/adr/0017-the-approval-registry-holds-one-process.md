# 0017 — The HITL approval registry holds one process, and every answer says so

- **Status:** accepted
- **Date:** 2026-09-21
- **Deciders:** recorded retroactively; see § Provenance
- **Closes:** nine dangling `ADR 0038` citations — four in production source, five in tests  <!-- adr-citation-ok: this ADR is the record of these dangling numbers; resolving them is what it exists to explain -->
  (B-238) — and records the decision B-236 acted on. **Six more are deliberately untouched;
  see § What this does not close.**

## Context

`getApprovalRegistry()` resolves a `processSingleton`. Four production files rest an argument on
that contract and all four pointed at a decision nobody could open:

| file | what it rests on the citation for |
|---|---|
| `packages/theo/src/server/agent/approval-registry.ts` | why the registry is process-wide at all |
| `packages/theo/src/server/agent/list-approvals-handler.ts` | why the listing is scoped the way it is |
| `packages/theo/src/server/agent/hitl-pause-spans.ts` | why the span store shadows the registry's lifetime |
| `tests/unit/harness-invariant-guard.test.ts` | what the guard's "enforcement teeth" enforce |

The last is the sharpest: a test that names itself after a document nobody can read, asserting what
that document forbids.

## Decision

**The registry is single-process by design, not by omission, and every answer it produces declares
that scope.**

Two halves, and the second is what makes the first honest:

1. **No durable store ships.** The interface is injectable so a Redis- or D1-backed implementation
   slots in without touching the harness, and none is built (YAGNI). A framework that shipped one
   would be choosing everybody's datastore for a feature most deployments pause zero times.

2. **The listing carries `scope`.** `GET /api/agents/<name>/approvals` answers
   `{ approvals: [...], scope: 'instance' }` — on every response, empty or not. Read from the
   registry rather than written into the handler, so an implementation that genuinely reaches
   further reports itself without this file changing, and a registry declaring nothing is read as
   `'instance'` because silence must take the narrow claim.

## Why the second half is not optional

Every deploy target the approvals listing became reachable on is multi-instance by construction — a
Worker is isolates, a Lambda is concurrent invocations. Without `scope`, an owner whose run paused
on another instance was answered `200 {approvals: []}`, which is indistinguishable from *nothing is
pending*. A pending approval that reads as absent is worse than an error: the operator stops
looking.

And the empty case is not the whole of it. A listing of two from one instance can be two of five,
so the declaration rides on every response — a caveat present only when the list is empty would
vanish exactly when a caller starts trusting the numbers.

## Alternatives rejected

**1 — Build the shared registry.** The complete fix, and it makes this framework choose a datastore
for every consumer. The interface exists so that choice stays the application's.

**2 — Return 501 on a multi-instance target.** Refuses a feature that works correctly for a
single-instance deployment, which is most of them, to protect a case the caller can now detect.

**3 — Say nothing and document the limit in the README.** What was already happening. The limit was
written in the registry's own header — *"a multi-instance deploy needs a shared registry"* — and the
response said nothing, so the only reader who learned it was the one who went looking in the source.

## Provenance — why this is numbered 0017 and not 0038

`ADR 0038` is cited ten times in this repository, four of them in the files above. Measured  <!-- adr-citation-ok: this ADR is the record of these dangling numbers; resolving them is what it exists to explain -->
2026-09-21: no file matching `0038-*` exists under `docs/adr/`, which holds 0001 through 0016, nor
under `apps/theocode/docs/adr/`.

It is almost certainly a real decision from the predecessor repository this code was moved from, so
nobody invented it — and that is precisely what makes it expensive to leave. A reader cannot tell a
citation that MOVED from one that was never written, and finding out costs the search that produced
this ADR.

## What this does not close

Six `ADR 0038` citations remain, all under `packages/agents/`, and they are left alone because they  <!-- adr-citation-ok: this ADR is the record of these dangling numbers; resolving them is what it exists to explain -->
are about a DIFFERENT decision. They cite it for the adapter seam — *"two THIN wrappers over the M12
`delegate`"*, *"the SDK's own awaited hook, never a second loop"*, *"this is the ADAPTER seam"* —
which has nothing to do with whether an approval registry spans processes.

So one predecessor number stood for at least two decisions, and repointing those six at this ADR
would replace an unresolvable citation with a resolvable WRONG one. That is the worse defect: a
reader following a dead link knows they learned nothing, and a reader following a live link to the
wrong decision does not. They stay dangling, named here, and recovering them is separate work.

## Provenance, continued

The same measurement found **28 cited ADR numbers that resolve to nothing, across 152 file
references** — ADR 0028 in 26 files, 0040 in 20, 0041 in 17. This ADR closes the ten that are  <!-- adr-citation-ok: this ADR is the record of these dangling numbers; resolving them is what it exists to explain -->
`0038` and does not renumber the rest; that is B-238's remaining scope.

Numbering follows `docs/adr/0005-the-root-bar-gate-sees-values-not-types.md`, which faced the same
question for `ADR 0061` and answered it the same way: the decision is recorded in THIS repository's  <!-- adr-citation-ok: this ADR is the record of these dangling numbers; resolving them is what it exists to explain -->
sequence, and the dangling number is explained rather than reserved. Reserving 0038 would leave a
gap of twenty-one numbers standing for documents this repository never had.
