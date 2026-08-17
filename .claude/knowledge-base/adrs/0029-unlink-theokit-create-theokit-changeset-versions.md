# ADR 0029 — Unlink `theokit` and `create-theokit` in changesets (independent version lines)

**Status:** Accepted
**Date:** 2026-06-19
**Deciders:** project owner

## Context

`.changeset/config.json` declared `"linked": [["theokit", "create-theokit"]]`.
Changesets' *linked* groups keep their members on the same version line: when
one member is bumped, the new version is computed from the **highest current
version in the group** plus the bump type.

But the two packages have long been on **divergent version lines**:

- `theokit` @ `0.6.0`
- `create-theokit` @ `1.0.15`

The last release (`02ee5da release: theokit@0.6.0 + create-theokit@1.0.15`) shipped
them at different versions — so the linked invariant was already not holding in
practice.

The breakage surfaced when preparing a behavior-preserving **patch** for
`theokit` (the architecture-report cleanup, ADR 0027/0028). A theokit-only patch
changeset under the linked config produces:

```
theokit 0.6.0 + patch, linked to create-theokit 1.0.15
  → new version = max(0.6.0, 1.0.15) + patch = 1.0.16
```

i.e. `theokit` jumps `0.6.0 → 1.0.16` — a spurious **major** signal for a change
with no public API impact. Verified by a local `changeset version` dry-run.

## Decision

**Set `"linked": []`.** `theokit` and `create-theokit` version independently.

- A `theokit` patch now produces `theokit@0.6.1` (verified by dry-run with linked
  removed).
- `create-theokit` keeps its own `1.0.x` line and bumps only when it has its own
  changeset.

## Alternatives considered

1. **Keep linked, accept `theokit → 1.0.16` (rejected).** Unifies the version
   lines but ships a false major-version signal for a behavior-preserving patch,
   confusing consumers and violating SemVer intent.
2. **Pin both to a shared line via `fixed` (rejected).** `fixed` forces identical
   versions on every release even without changes; the two packages have
   independent release cadences (a scaffolder vs the framework), so coupling
   their versions is wrong, not just inconvenient.
3. **Manual per-package version bumps outside changesets (rejected).** Loses the
   changesets CHANGELOG generation + provenance publish flow the repo relies on
   (`release.yml`).

## Consequences

- `theokit` and `create-theokit` release on independent SemVer lines (matching
  reality since before this ADR).
- The pending `theokit` patch changeset will version to `0.6.1` when
  `release.yml` (`changesets/action`) runs on `main`.
- No effect on the actual npm publish mechanism (still CI-driven with OIDC
  provenance).
- Reversible: re-add the `linked` array if a future decision unifies the lines
  (would require first reconciling the two version numbers onto one line).
