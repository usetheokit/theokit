# 0024. Auth architecture — Caminho C (Hybrid) chosen for `defineAuth` + opt-in `@theokit/auth-*` providers

* Status: accepted
* Date: 2026-06-03
* Deciders: [TheoKit team]
* Tags: [auth, oauth, oidc, sdk-architecture, plugin-architecture, lock-evolution]

## Context and Problem Statement

The 2026-05-19 **AUTH-DELEGATION lock** in [`./CLAUDE.md:217-225`](../../CLAUDE.md) defined two acceptable paths for shipping auth-shaped features:

- **Caminho A** — ship only RFC-stable protocol primitives (PKCE, state, OIDC discovery, TOTP); delegate provider concretes to specialist libraries (Auth.js, Better Auth, Iron Session). This is the current state.
- **Caminho B** — bundle concrete providers in the framework core (Remix 3 pattern, 9 providers shipped). The lock explicitly contra-indicates this for a single-maintainer scope.

A third path — **Caminho C (Hybrid)** — was only sketched in the lock's escape-hatch clause: *"If we do adopt later: ship providers as separate optional packages under `@theokit/auth-*`, NEVER in the framework core. Each package owns its provider's deltas and ships independently."*

The G11 discovery (`g11-auth-architecture-decision`, blueprint at `.claude/knowledge-base/discoveries/blueprints/g11-auth-architecture-decision-blueprint.md`) ran a 6-question audit (Q1-Q6) across `.claude/knowledge-base/references/{wasp,nextjs,remix,sveltekit,nuxt}/` and uniformly converged on **Caminho C** as the only path that (a) uses the existing 11-file primitive set, (b) honors the single-maintainer constraint, and (c) keeps `@theokit/sdk` itself stable while the provider count grows.

## Decision Drivers

* **Q5 — primitive leverage:** `theokit/packages/theo/src/server/auth/` already ships PKCE + state + OIDC discovery + crypto + session + nonce + TOTP + backup codes + throttle (11 files). Caminho C's per-provider adapters consume these directly — zero reinvention.
* **Q3 — cross-framework consistency:** Next.js (Auth.js), SvelteKit (delegated SvelteKitAuth), Nuxt (Auth.js / NuxtAuth) all delegate. Wasp's bundle is a full-time-team outlier.
* **Q1+Q4 — bundled-provider maintenance reality:** Wasp's 17-day report-to-release on one normalization bug (the case-sensitive `sub` lowercase incident) required user-side data migration. Per-package semver in Caminho C isolates that blast radius to a single npm package.
* **Q2 — lock trigger status:** Trigger 1 (team of 3+) NOT satisfied; Trigger 3 (specialist lib breaks) partially fires (Lucia DEPRECATED per `webfetch:npm:lucia` 2026-06-03). Caminho C is the lock's own approved evolution path.

## Considered Options

* **Caminho A (status quo)** — honest and aligned with the lock; throws away leverage of bundled primitives for the 80% case where an app wants Google + GitHub + magic link without learning Auth.js.
* **Caminho B (bundled providers)** — directly violates the lock; requires Trigger 1 (team of 3+) to revoke.
* **Caminho C (Hybrid)** — `@theokit/sdk` ships orchestrator core (6 stable exports); providers ship as opt-in `@theokit/auth-*` separate packages.

## Decision Outcome

Chosen: **Caminho C (Hybrid)**.

The lock STAYS as authoritative — Caminho C is the lock's own approved evolution path. Implementation lands in plan `g11-auth-architecture-implementation` v1.4:

1. **`@theokit/sdk@1.6.0` ships 6 new exports** under `/server/auth`:
   - `defineAuth<TSession>(opts): AuthOrchestrator<TSession>`
   - `DefineAuthOptions<T>` / `AuthOrchestrator<T>` interfaces
   - `AuthProvider<TProfile, TName>` interface (provider contract)
   - `AuthResult<TProfile, TName>` interface
   - `OAuthTransaction` interface
2. **`@theokit/auth-{google,github,magic-link}@0.1.0`** ship as separate npm packages. Each ~150-200 LoC. peerDep `@theokit/sdk@>=1.6.0`. Semver-independent.
3. **`@theokit/plugin-auth@0.1.0`** becomes a meta-package bundling the 3 Tier-1 providers + `createSaasAuth` convenience helper for the `create-theokit --template saas` boilerplate.

### Positive Consequences

* Orchestrator API stable at 6 exports; provider count grows independently.
* Per-package semver isolates breaking changes to a single npm install.
* Bundle scales with usage (single-provider apps install only what they need).
* Existing 11-file primitive set reused — zero reinvention.
* Community can ship Tier-2+ providers (`@<scope>/theokit-auth-<name>`) without core review.

### Negative Consequences

* Apps managing 5+ providers have 5+ package installs (mitigated by `@theokit/plugin-auth` meta-package).
* TheoKit team initially owns 3 npm packages (`@theokit/auth-google` + `auth-github` + `auth-magic-link`).
* Dual code paths in the orchestrator (full OAuth flow via `startSignIn` + Caminho-A escape-hatch via `signIn(profile, providerName)`) need consistent docs.

## Cross-references

- Plan: [`g11-auth-architecture-implementation-plan.md`](../../../.claude/knowledge-base/plans/g11-auth-architecture-implementation-plan.md) v1.4
- Blueprint: [`g11-auth-architecture-decision-blueprint.md`](../../../.claude/knowledge-base/discoveries/blueprints/g11-auth-architecture-decision-blueprint.md) § Recommendations
- Lock: [`theokit/CLAUDE.md`](../../CLAUDE.md) § "Architectural decisions on record" → AUTH-DELEGATION
- Sibling ADRs: [0025](./0025-lucia-removed-from-tier-1.md), [0026](./0026-auth-lib-friction-github-label.md), [0027](./0027-auth-lock-semi-annual-revalidation.md)
