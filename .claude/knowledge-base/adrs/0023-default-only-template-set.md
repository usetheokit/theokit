# ADR 0023 — Converge on a default-only template set

**Status:** Accepted
**Date:** 2026-06-17
**Deciders:** project owner

## Context

TheoKit's scaffolding lives across two packages:

- `packages/create-theokit/` — the **published, active** scaffolder (`create-theokit` on npm). Its `getTemplateDir()` resolves `../templates/<name>`, and its `templates/` directory shipped **only `default`**.
- `packages/create-theo/` — the **standalone scaffolder being absorbed** into `create-theokit` (Ecosystem table, repo `CLAUDE.md`). Its `templates/` directory carried four extra templates: `api-only`, `dashboard`, `postgres`, `saas`.

The Ecosystem table previously listed the canonical TheoKit template set as `default / dashboard / api-only / postgres / saas` (5 templates) with a planned `--backend` flag. In practice the active scaffolder only ever shipped `default`; the four extras existed solely in the deprecated `create-theo` package and were exercised by tests (`scaffold-saas-template`, `template-postgres`, `all-templates-primitives-dogfood`, and the `template-*` e2e specs), several of which were perpetually RED because the templates were incomplete stubs.

## Decision

**Converge on a single canonical template — `default` — shipped by `create-theokit`.**

- Remove `packages/create-theo/templates/{api-only,dashboard,postgres,saas}`.
- Keep `packages/create-theo/templates/` as a directory with a `README.md` pointing to the canonical `default` in `create-theokit` (the standalone package is in deprecation).
- Remove the tests that exclusively exercise the deleted templates: `tests/unit/scaffold-saas-template.test.ts`, `tests/unit/template-postgres.test.ts`, `tests/unit/all-templates-primitives-dogfood.test.ts`, and `tests/e2e/template-{api-only,dashboard,postgres,saas}.spec.ts`.
- Correct the `create-theokit` "template not found" error message to advertise only `default`.

Polyglot backends are delivered via the `--backend` flag on `create-theokit` (Wave 2 design), **not** via separate scaffold templates.

## Alternatives considered

1. **Complete the four extra templates (rejected).** Restoring full saas/postgres/dashboard/api-only templates (briefly done in commit `7575f30`) keeps a 5-template maintenance surface across a package that is being deprecated. The owner chose to narrow scope rather than carry four lightly-used templates.
2. **Delete the entire `create-theo/templates/` directory (rejected).** The owner asked to keep the directory (with a README) so the deprecation path is discoverable rather than silently absent.
3. **Move the four templates into `create-theokit` (rejected).** Same maintenance cost, just relocated; the decision is to reduce the template set, not relocate it.

## Consequences

- The only template anywhere in the repo is `packages/create-theokit/templates/default`.
- `create-theokit <name>` (default) and `--template=default` continue to work unchanged.
- `--template={dashboard,api-only,postgres,saas}` now errors with "Available templates: default" — there were no published consumers of those names (create-theokit never shipped them).
- The Ecosystem table in `CLAUDE.md` is updated to reflect default-only.
- The default-cascade tests that point at `create-theo/templates/default` (`create-theo-default-template`, `scaffold-default-agent`, etc.) remain a **separate** open item — `default` is canonical in `create-theokit`, and repointing those tests is tracked outside this ADR.

## References

- Ecosystem table + governance rule: repo `CLAUDE.md` (§ Ecosystem — changes require ADR + migration plan + table update).
- Prior template-version ADR: `docs/adr/0019-template-version-sync-source-of-truth.md`.
