---
'create-theokit': patch
---

Four templates were removed and never announced: `saas`, `dashboard`, `api-only` and `postgres`. `--template=saas` has been failing since, with an error that correctly names the one template that exists — but nothing in the release notes explained where the other four went, so the failure read as a bug rather than as a removal.

What ships today is `default`. `services/` and `surfaces/` under `templates/` are fragments for `--backends` and `--surface`, not values for `--template`.

Release notes from before the removal still describe those templates in the present tense, and some describe wiring inside them. In particular, the `saas` entry says it "wires `trackAgentRun` in `server/routes/agent.ts`" — that file no longer exists anywhere in this package, and `trackAgentRun` has no production caller in the framework either (usetheokit/theokit#353). Those entries are historical records of what shipped at the time and are left as they are; this note is the correction that was missing.

Refs usetheokit/theokit#354.
