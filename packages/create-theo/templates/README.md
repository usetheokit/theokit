# create-theo templates

**This directory is intentionally empty.**

TheoKit ships a **single, canonical template — `default`** — and it lives in the
active scaffolder package: [`packages/create-theokit/templates/default`](../../create-theokit/templates/default).

The standalone `create-theo` scaffolder is being **absorbed into `create-theokit`**
(see the Ecosystem table in the repo `CLAUDE.md`). The previous extra templates
(`api-only`, `dashboard`, `postgres`, `saas`) were removed on 2026-06-17 to
converge on default-only — see ADR `docs/adr/0023-default-only-template-set.md`.

If you need a polyglot backend, use the `--backend` flag on `create-theokit`
rather than a separate template (Wave 2 design).
