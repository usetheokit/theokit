# 0025. Lucia removed from Tier-1 auth-library recommendation

* Status: accepted
* Date: 2026-06-03
* Deciders: [TheoKit team]
* Tags: [auth, dependencies, docs, lock-trigger-3, npm-deprecation]

## Context and Problem Statement

The 2026-05-19 AUTH-DELEGATION lock named **three Tier-1 specialist libraries** as recommended delegation targets:

1. **Auth.js** (NextAuth) — multi-provider workhorse, largest matrix
2. **Better Auth** — modern TypeScript-first DX
3. **Lucia** — lightweight session-only
4. **Iron Session** — listed as fallback below Lucia

During the G11 discovery (`g11-auth-architecture-decision`, blueprint Q2), an `npm view lucia` WebFetch on 2026-06-03 returned:

> **This package has been deprecated.**
> Please see https://lucia-auth.com/lucia-v3/migrate.

The Lucia project itself is wound down. The recommendation matrix in [`docs/concepts/auth-providers.md`](../concepts/auth-providers.md) currently still names Lucia as Tier-1.

This is **Lock Trigger 3 firing partially** (a specialist library breaks compatibility — here the library wound down entirely; functionally equivalent for users).

## Decision Drivers

* **Trigger 3 telemetry:** Lucia npm deprecation tombstone is empirical evidence; no judgment required.
* **User harm:** copy claiming "Lucia is recommended" misdirects users into a dead-end migration.
* **Replacement quality:** Iron Session occupies the same niche (lightweight session-only) and remains maintained.

## Considered Options

* **Keep Lucia as Tier-1 with deprecation footnote** — half-measure; readers still skim past footnotes.
* **Promote Iron Session into the Tier-1 slot vacated by Lucia** — direct replacement; same niche.
* **Drop the lightweight-session slot entirely** — over-correction; some apps genuinely don't need a multi-provider workhorse.

## Decision Outcome

Chosen: **Promote Iron Session into the Tier-1 slot vacated by Lucia.**

Final Tier-1 list:

1. **Auth.js** (multi-provider workhorse)
2. **Better Auth** (modern TypeScript-first DX)
3. **Iron Session** (lightweight session-only)

`docs/concepts/auth-providers.md` updated in the same PR (per plan T8.2). Recommendation matrix table header note added: *"As of 2026-06-03 Lucia is DEPRECATED in npm (per discovery `g11-auth-architecture-decision`). Tier-1 recommendations: Auth.js v5, Better Auth, Iron Session."*

### Positive Consequences

* Users following our recommendation no longer hit a dead-end migration.
* Tier-1 slot stays filled (lightweight session-only is a real category).

### Negative Consequences

* Existing apps using Lucia (per our previous recommendation) need their own migration path — Lucia maintainers provide one at `lucia-auth.com/lucia-v3/migrate`.
* Iron Session is a smaller community than Lucia was at peak; ecosystem deltas may shift again.

## Cross-references

- Discovery blueprint: [`g11-auth-architecture-decision-blueprint.md`](../../../.claude/knowledge-base/discoveries/blueprints/g11-auth-architecture-decision-blueprint.md) § ADRs § D2
- Lock: [`theokit/CLAUDE.md`](../../CLAUDE.md) § AUTH-DELEGATION Trigger 3
- Sibling ADRs: [0024](./0024-auth-caminho-c-hybrid.md), [0026](./0026-auth-lib-friction-github-label.md), [0027](./0027-auth-lock-semi-annual-revalidation.md)
- Updated doc: [`docs/concepts/auth-providers.md`](../concepts/auth-providers.md)
