# 0027. Auth-delegation lock — semi-annual re-validation cadence

* Status: accepted
* Date: 2026-06-03
* Deciders: [TheoKit team]
* Tags: [auth, governance, lock-evolution, cadence]

## Context and Problem Statement

The 2026-05-19 AUTH-DELEGATION lock status changes silently when:

- A specialist library (Auth.js / Better Auth / Iron Session) drops maintenance, ships a breaking change, transfers ownership, OR receives a security advisory (Trigger 3 events).
- An npm deprecation tombstone lands on a recommended library (already happened with Lucia, addressed in [ADR-0025](./0025-lucia-removed-from-tier-1.md)).
- Browser / specification changes (PKCE, OIDC discovery, cookie SameSite, etc.) invalidate a primitive choice.

These events are not announced via TheoKit's own channels — we have to look. Without a scheduled re-check, status drifts and the lock becomes stale by accident (the Lucia case is the case study).

## Decision Drivers

* **Continuous monitoring is overkill** for a 3-library recommendation matrix.
* **Annual is too slow** — Lucia's deprecation would have been caught 5 months later.
* **Quarterly is too aggressive** — most quarters will produce zero updates and the cadence becomes ignored noise.
* **Reproducible methodology exists:** the G11 discovery blueprint's Q2 trigger-check script + npm WebFetch flow is the re-run target.

## Considered Options

* **Annual re-validation** — too slow; misses mid-year npm deprecations (Lucia case).
* **Quarterly re-validation** — overhead exceeds signal for a 3-lib matrix.
* **Event-driven re-validation** (only when a trigger fires) — depends on observation, which depends on the re-validation we're trying to schedule.
* **Semi-annual (every 6 months)** — catches Trigger 3 events without continuous monitoring overhead; aligns with TheoKit's own minor-version cadence.

## Decision Outcome

Chosen: **Re-run AUTH-DELEGATION lock Q2 trigger checks every 6 months.**

* Next re-validation: **2026-12-03**.
* Trigger script: re-run the methodology documented in `g11-auth-architecture-decision-blueprint.md` § Q2 (npm WebFetch for each Tier-1 lib + GitHub `auth-lib-friction` label count check + framework changelog scan for `.claude/knowledge-base/references/{nextjs,sveltekit,nuxt,remix,wasp}/CHANGELOG*`).
* Output: a fresh discovery slug `g11-lock-revalidation-2026-12-03` with the same blueprint shape (Q1-Q6 re-run, ADRs appended) — even if the conclusion is "lock stays unchanged".
* If a trigger fires (1, 2, or 3), spawn the appropriate follow-up: Caminho B re-feasibility plan, new Tier-1 lib promotion, or new primitive shipped in `theokit/server/auth/`.

### Positive Consequences

* Scheduled discovery prevents silent staleness.
* Methodology is reproducible from the G11 blueprint — no re-design.
* Discovery output is auditable: even "lock unchanged" is a documented re-affirmation.

### Negative Consequences

* Costs ~4-8 hours of focused discovery work twice a year.
* Half-year window means a trigger event in month 1 sits unaddressed for ~5 months — mitigated by ADR-0026 telemetry tap.

## Cross-references

- Discovery blueprint: [`g11-auth-architecture-decision-blueprint.md`](../../../.claude/knowledge-base/discoveries/blueprints/g11-auth-architecture-decision-blueprint.md) § ADRs § D4 + Q2 methodology
- Lock: [`theokit/CLAUDE.md`](../../CLAUDE.md) § AUTH-DELEGATION re-evaluation triggers
- Sibling ADRs: [0024](./0024-auth-caminho-c-hybrid.md), [0025](./0025-lucia-removed-from-tier-1.md), [0026](./0026-auth-lib-friction-github-label.md)
- Scheduled follow-up discovery: `g11-lock-revalidation-2026-12-03` (to be created on or before 2026-12-03)
