---
slug: issue-78-wrangler-smoke-optin
milestone_id:
created_at: 2026-07-05
goal: Make the CF Workers smoke skip cleanly by default (opt-in via THEOKIT_E2E_WRANGLER) so it never hits the 90s beforeAll hook-timeout in environments without a working wrangler dev / workerd toolchain (issue #78).
---

# Plan — issue #78: wrangler-smoke opt-in gate

## Goal

`tests/integration/wrangler-smoke.test.ts` must **skip cleanly and fast** by default, instead of
failing with a 90 s `beforeAll` hook timeout wherever `wrangler` is installed (devDep) but
`wrangler dev` cannot bind (no network / workerd — every sandbox/minimal CI). Running the real CF
Workers smoke becomes an explicit opt-in (`THEOKIT_E2E_WRANGLER=1`).

## Strategic alignment (operator decision, 2026-07-05)

The sandbox / validated environment IS **TheoCloud** — the only end-to-end-validated deploy target
(CLAUDE.md). **Cloudflare Workers is a future / opt-in compatibility surface**, not a validated gate.
Therefore the CF smoke should NOT run by default anywhere (no CI wiring), and NOT be treated as
coverage we depend on. It stays runnable on demand for whoever validates CF locally.

## Baseline context

- `tests/integration/wrangler-smoke.test.ts` — top-level guard `resolveWrangler()` → `WRANGLER_BIN`;
  if `undefined`, `it.skip` + `return`. Otherwise `beforeAll` (90 s timeout) spawns `wrangler dev`
  and polls `fetchWithRetry` (30×1 s). The binary guard passes here (`wrangler --version` = 4.102.0),
  but `wrangler dev` never binds → hook times out at 90 000 ms.
- CI (`ci.yml`) runs the smoke via `pnpm test` / `pnpm test:coverage` with **no wrangler-specific
  setup** — so today it runs unconditionally wherever the binary is present.
- vitest 4.1.9 — `describe`-level early-return skip is the established pattern in this very file.

## Coverage matrix

| Goal claim | Task |
|---|---|
| Default (no env) → clean skip, no 90 s timeout | T1 + AC-1 |
| Opt-in path preserved (`THEOKIT_E2E_WRANGLER=1` still runs the real smoke) | T1 + AC-2 |
| Honest skip message naming the env var | T1 + AC-3 |
| No other test affected; lint + typecheck clean; full gate green | T2 |

## Tasks

### T1 — Add the opt-in env gate to the suite guard
- Introduce `E2E_WRANGLER_OPT_IN = process.env.THEOKIT_E2E_WRANGLER === '1' || … === 'true'`.
- In the `describe`, add a first early-return: when NOT opted in, `it.skip('SKIPPED — opt-in only:
  set THEOKIT_E2E_WRANGLER=1 …')` + `return`, BEFORE the existing binary guard (which stays, so the
  `WRANGLER_BIN` narrowing to `string` is preserved for the `beforeAll`).
- Do NOT touch `ci.yml` — CF Workers stays opt-in/future per the strategic decision.

**TDD shape:**
- RED (current, documented): default `npx vitest run tests/integration/wrangler-smoke.test.ts` →
  `FAIL … Hook timed out in 90000ms` (~90 s).
- GREEN: same command → the file passes with the suite `skipped`, completing in a few seconds.

### T2 — Regression + gate
- Lint + typecheck the changed file clean.
- Re-run the file with `THEOKIT_E2E_WRANGLER` unset (skip, fast) AND set (structurally reaches the
  real body — in the sandbox it will attempt `wrangler dev`; that opted-in attempt is out of scope,
  the operator owns the toolchain when opting in).
- Confirm no other test references / depends on this file’s default-run behavior.

## Acceptance criteria (all must have evidence)

- **AC-1** — with `THEOKIT_E2E_WRANGLER` unset, the file completes as `skipped` in **< 10 s** (no
  90 s hook timeout). Measured wall-clock evidence required.
- **AC-2** — with `THEOKIT_E2E_WRANGLER=1`, the guard falls through to the real `describe` body (the
  binary guard still applies). Evidence: the skip message for the opt-in case is NOT emitted.
- **AC-3** — the default skip message contains `THEOKIT_E2E_WRANGLER`.
- **AC-4** — `eslint` + `tsc` clean on the file; the surrounding integration suite still green.

## Drawbacks & risks

1. **CF Workers smoke no longer runs by default (incl. CI).** Accepted: CF Workers is opt-in/future
   per the operator decision; TheoCloud is the validated target. Not coverage we depend on.
2. **Opt-in-but-broken toolchain still slow.** When someone sets `THEOKIT_E2E_WRANGLER=1` in an env
   where `wrangler dev` can't bind, they still hit the bind budget. Out of scope — opting in is an
   explicit "I have the toolchain" assertion; the operator owns it. (A future hardening could shrink
   the bind budget + surface `wrangler` stderr — issue #78 secondary scope, deferred.)

## Unresolved questions

- (none) — root cause and fix confirmed with file:line evidence; CF-default-off is an explicit
  operator decision, not an ambiguity.

## Test plan

Run the target file twice (env unset → skip+fast; env set → reaches body), lint + typecheck, then a
scoped integration-suite run to confirm no regression. No product code touched — a single test-guard
change.
