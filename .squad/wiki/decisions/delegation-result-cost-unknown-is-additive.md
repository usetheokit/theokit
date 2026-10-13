# `DelegationResult` reports an unpriced run with an added flag, not an optional `cost`

- Status: Accepted
- Date: 2026-10-08
- Decided by: the system under the autonomy envelope (structural decision recorded, not approved)
- Items: B-409, B-419 (code-review finding #86, commit 0450dfd8)

## Context

`DelegationResult.cost` reported the known spend as the run's cost when a round had no price, so
an unpriced run read as $0. `DoneEvent.cost` already models an unknown price as an absent key.

## Decision

Add `costUnknown?: true`, set when any round had no finite cost, and keep `cost` as the known
spend that the ceiling and the budget errors read. A fully priced run carries no new key.

## Options rejected

- **Make `cost` optional**, as `DoneEvent.cost` is. It would mirror the event, but it is a breaking
  change to a public type of `@theokit/agents` 15.x, so a major version for one field.
- **Report `NaN` or `-1` for an unknown cost.** A magic value, which the error-handling rule forbids.

## Who is affected, and what breaks

Every consumer of `DelegationResult`, found by searching `packages/` and `apps/` for the type:
the delegate tool and the orchestrator in `packages/agents`. Nothing breaks: the field is
additive. The cost of the choice is that the compiler does not force a consumer to read the flag;
the changeset says so.
