# 0026. Establish `auth-lib-friction` GitHub label for Trigger 2 telemetry

* Status: accepted
* Date: 2026-06-03
* Deciders: [TheoKit team]
* Tags: [auth, telemetry, github-process, lock-trigger-2]

## Context and Problem Statement

The 2026-05-19 AUTH-DELEGATION lock defines Trigger 2 as: *"Concrete user demand from shipped TheoKit apps with measured pain — 'I tried Auth.js and couldn't make it work' reports >5 per month."*

This trigger is **UNKNOWN_PROXY** — no measurement framework exists. We do not know whether 0 or 50 users per month try Auth.js and fail. The G11 discovery (`g11-auth-architecture-decision`, blueprint Q2) flagged this honestly per Inquebrável Rule 3 (no fabricating metrics).

Without telemetry, Trigger 2 cannot fire. Without firing, the lock cannot be re-evaluated. The lock effectively becomes immutable for the wrong reason (absence of evidence ≠ evidence of absence).

## Decision Drivers

* **Honest measurement:** if we recommend delegating to Auth.js / Better Auth / Iron Session and friction is real, we need to know.
* **Low-friction process:** no new tooling, no dashboard — re-use GitHub's existing labels system.
* **Time-bounded re-check:** 4-6 week observation window aligns with the @next → @latest promotion cadence in plan G11 T9.4.

## Considered Options

* **Embed a telemetry SDK in templates** — heavy, requires user opt-in, raises privacy concerns.
* **Survey TheoKit community quarterly** — slow, sample bias.
* **GitHub label for friction reports** — zero new infra; counts are queryable via `gh issue list --label auth-lib-friction --state all`.

## Decision Outcome

Chosen: **Create GitHub label `auth-lib-friction` on the `usetheo/theokit` repo.**

Process:

1. Label created at https://github.com/usetheo/theokit/labels with color `#d93f0b` (warning orange) and description: *"User reported friction integrating Auth.js / Better Auth / Iron Session with TheoKit session primitives."*
2. [`CONTRIBUTING.md`](../../CONTRIBUTING.md) issue triage section documents when to apply the label (any issue mentioning the three specialist libs alongside `theokit/server/auth` primitives — friction OR success — gets tagged).
3. Re-check after 4-6 weeks of issue data BEFORE promoting G11 / P#1 to `@latest` (per plan T9.4).
4. If Trigger 2 fires post-window (>5 reports/month sustained), the lock re-opens for evaluation of Caminho B feasibility.

### Positive Consequences

* Zero new infra. Re-uses existing GitHub Issues.
* Counts are queryable, public, reproducible.
* Closing the loop on Trigger 2 status — measurable instead of "UNKNOWN_PROXY".

### Negative Consequences

* Selection bias: users who file GitHub issues are not a random sample.
* Friction-with-third-party-libs is partially a GitHub label for "GitHub itself" — issues filed at Auth.js / Better Auth may never reach TheoKit's tracker.

## Cross-references

- Discovery blueprint: [`g11-auth-architecture-decision-blueprint.md`](../../../.claude/knowledge-base/discoveries/blueprints/g11-auth-architecture-decision-blueprint.md) § ADRs § D3 + Q2 EC-5
- Lock: [`theokit/CLAUDE.md`](../../CLAUDE.md) § AUTH-DELEGATION Trigger 2
- Sibling ADRs: [0024](./0024-auth-caminho-c-hybrid.md), [0025](./0025-lucia-removed-from-tier-1.md), [0027](./0027-auth-lock-semi-annual-revalidation.md)
- Manual action: label creation at https://github.com/usetheo/theokit/labels (plan T8.3)
