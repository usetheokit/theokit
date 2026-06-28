# Deps Audit: agents-stream-chronological-order

**Date:** 2026-06-28
**Mode:** plan-bound:agents-stream-chronological-order
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm (pnpm workspace)
- Plan-declared deps audited: 1 (`@theokit/sdk` — existing; 0 new)
- Vulnerabilities on the PLAN's dependency surface (`@theokit/sdk` / `@theokit/agents`): 0 critical, 0 high, 0 moderate, 0 low
- Repo-wide findings (OUT of this plan's surface): 1 high, 4 moderate, 1 low — all transitive under `@theokit/ui`/build tooling in fixtures, NOT reachable via `@theokit/sdk` or `@theokit/agents`
- Auditor coverage: { pnpm-audit: ran, osv-scanner: available (1.9.2) }

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@theokit/sdk` | Existing | yes — declared `^2.9.0` in `packages/agents/package.json` (plan said `^2.11.0`; range `^2.9.0` is compatible/satisfied by installed 2.11.0) | yes — no CVE on this dep | n/a (existing) | OK |
| (none) | New | — | — | — | no new dep |

## Repo-wide findings — OUT of this plan's dependency surface (pre-existing)

Recorded for honesty; they do NOT gate this plan (golden-rule hard cap #3 applies to **declared** deps; none of these are declared by this plan, and none are reachable via `@theokit/sdk` or `@theokit/agents`).

- **HIGH** — `valibot@0.42.1` ReDoS in `EMOJI_REGEX` (GHSA-vqpr-j7v3-hqw9; patched ≥1.2.0). **Path:** `fixtures/services-both > theokit > @theokit/ui > valibot`. `pnpm why valibot` shows **no `@theokit/sdk` path**; `pnpm --filter @theokit/agents why valibot` is **empty** → not in this plan's surface. Belongs to `@theokit/ui`'s dependency tree.
- MODERATE — `esbuild` (dev request SSRF), `uuid` (buffer bounds v3/v5/v6), `js-yaml` (quadratic merge-key DoS) — build/transitive tooling, repo-wide, not this plan's surface.
- LOW — `esbuild` arbitrary file read (dev server) — dev-only.

## Recommended next steps

1. The plan's dependency surface is clean → proceed to `/plan-confidence`.
2. Repo-wide transitive findings (valibot HIGH via `@theokit/ui`, etc.) are a SEPARATE, pre-existing concern owned by `@theokit/ui`'s tree — track independently (out of scope for #44). NOT introduced or touched by this plan.

_No manifest edited (read-only). No secrets in this report._
