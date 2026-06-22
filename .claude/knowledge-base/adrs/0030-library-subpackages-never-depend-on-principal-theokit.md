# ADR 0030 — Library sub-packages must NEVER depend on the principal `theokit`

**Status:** Accepted
**Date:** 2026-06-22
**Deciders:** project owner

## Context

`theokit` (`packages/theo`) is the **principal** project. The library
sub-packages (`@theokit/http`, `@theokit/agents`, …) are consumed **by**
theokit — the dependency direction is strictly **main → libs**.

`@theokit/http/package.json` declared `peerDependencies.theokit = ">=0.2.0"`,
inverting that direction and creating a **circular graph**:

```
theokit ──(dependencies)──▶ @theokit/agents ──(peer)──▶ @theokit/http ──(peer)──▶ theokit
```

This is also where the **spurious major cascade** came from. Changesets' default
rule (`@changesets/assemble-release-plan`, `onlyUpdatePeerDependentsWhenOutOfRange`
defaults to `false`) bumps any **peer-dependent** to a **MAJOR** when its peer is
released — *regardless of whether the new version stays in range*. So a `theokit`
**minor** forced:

```
theokit 0.6.1 → 0.7.0 (minor)
  → @theokit/http → 1.0.0 (MAJOR, peer-dependent of theokit)
  → @theokit/agents → 1.0.0 (MAJOR, peer-dependent of @theokit/http)
```

Two spurious **major** releases (0.x → 1.0.0, the "production-stable" signal) for
packages with **no code change**, as a side effect of a theokit minor. Confirmed
by `changeset version` / `changeset status` dry-runs during the theokit@0.7.0
release (2026-06-22).

The `theokit` peer-dep was **spurious to begin with**: `@theokit/http` has **no
executable import** of `theokit` — the only references are JSDoc usage examples
(`packages/http/src/theokit-plugin.ts:14,77`), and line 77 explicitly documents
"Pattern D6 — we don't import … from `theokit/server`". So the dependency that
caused the cascade contradicted the package's own documented design.

`onlyUpdatePeerDependentsWhenOutOfRange: true` was attempted as a config-only fix
but did not suppress the cascade in this graph (changesets 2.31.0). The right fix
is architectural, not a config flag: remove the wrong-direction dependency.

## Decision

1. **Remove `peerDependencies.theokit` from `@theokit/http`.** No library
   sub-package declares `theokit` (the principal) as a dependency of any kind
   (`dependencies` / `peerDependencies` / `devDependencies` / `optionalDependencies`).
2. **Enforce the rule with a CI guard** — `scripts/check-package-direction.mjs`
   (wired into `pnpm check:all` as `check:direction`) scans every `packages/*`
   and fails if any non-principal package depends on `theokit`. Private consumer
   artifacts (`fixtures/*`, create-* template trees) legitimately consume theokit
   and are out of scope.

The reverse direction stays as-is and correct: `theokit` (main) **may** depend on
`@theokit/agents` / `@theokit/http` / `@theokit/ui` (main → libs).

## Consequences

- A `theokit` minor/patch no longer cascades any library to a spurious major.
  Verified by `changeset status` dry-run: a `theokit: minor` changeset now bumps
  **only** `theokit` (+ private fixtures at patch); "Running release would release
  NO packages as a major".
- The main → libs direction is machine-enforced; the regression cannot silently
  return.
- `@theokit/http` consumers are unaffected: http never imported theokit, so no
  runtime/type behavior changes. The published `@theokit/http` simply no longer
  declares a peer it never used.

## Alternatives considered

- **`___experimentalUnsafeOptions.onlyUpdatePeerDependentsWhenOutOfRange: true`** —
  did not suppress the cascade in this circular graph (changesets 2.31.0), and it
  would only have masked a dependency that should not exist. Rejected.
- **`linked` / `fixed` changeset groups** — would intentionally couple the version
  lines, the opposite of the desired independence (cf. ADR 0029, which *unlinked*
  theokit/create-theokit for the same family of spurious-bump problems). Rejected.
- **Keep the peer-dep, accept the majors** — publishes false breaking releases and
  burns the 0.x → 1.0 signal for no reason. Rejected.

## Related

- ADR 0029 — Unlink `theokit` and `create-theokit` in changesets (same family:
  changeset config producing spurious version bumps).
- `scripts/check-package-direction.mjs` — the enforcement guard.
- theokit@0.7.0 release (2026-06-22) — where the cascade was diagnosed and the
  http/agents majors were manually suppressed before publish.
