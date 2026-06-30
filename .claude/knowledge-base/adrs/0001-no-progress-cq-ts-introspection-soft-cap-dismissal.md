# ADR 0001 — Dismiss `symbol_fab_unverifiable_typescript` soft cap for theokit#53 fix

**Date:** 2026-06-30
**Status:** Accepted
**Scope:** code-quality FAIL_SOFT on slug `no-progress-signature-tool-calls-only`
**Context cycle:** cycle-code-quality → cycle-review handoff

## Context

`/code-quality` on the theokit#53 fix returned **FAIL_SOFT (70)** driven by a single SOFT_CAP: `symbol_fab_unverifiable_typescript` (8 D2 findings, all "unverifiable"; **0 HARD** — no real symbol fabrication, no dead code). `cycle-review` requires that a FAIL_SOFT be "accompanied by an ADR dismissing each soft cap" (`code-quality-golden-rule.md` § 1) to proceed.

## Decision

**Dismiss `symbol_fab_unverifiable_typescript`** for this change.

## Rationale

1. **"Unverifiable" is an auditor limitation, not a defect.** D2's tree-sitter + registry path cannot introspect TypeScript package member-access — explicitly deferred in the `/code-quality` skill roadmap ("D2 member-access introspection for TypeScript ... deferred"). It reports "I cannot verify", not "this symbol does not exist". Zero HARD `symbol_fabrication_typescript` findings.
2. **The authoritative TS symbol check passed clean.** `npx tsc --noEmit -p packages/agents/tsconfig.test.json` → exit 0, and the tsup DTS build succeeded — two independent, authoritative symbol-resolution passes confirm every symbol in the changed files resolves.
3. **Repo-wide, not introduced by this change.** The same soft cap fires for any TypeScript plan in this repo (consistent with `/plan-confidence`'s embedded-CQ `--no-code-quality` gotcha). The change itself is a 1-line `roundSignature` narrowing + 3 tests + a test-harness correction — it adds no unresolved symbol.

## Alternatives considered

- **Block on FAIL_SOFT and loop back to /implement** — rejected: there is no defect to fix; the cap is a tooling limitation, and looping would be theatre.
- **Add an allowlist entry** — rejected: the allowlist downgrades severity for a *real* finding with a sunset; here there is no real finding, and the limitation is repo-wide and permanent until D2 TS introspection ships. An ADR dismissal is the correct instrument.

## Consequences

- `cycle-review` may proceed for slug `no-progress-signature-tool-calls-only`.
- When D2 TypeScript member-access introspection ships, re-running `/code-quality` should reclassify these from "unverifiable" to "verified" and the soft cap will not fire.

## Cross-references

- Audit: `knowledge-base/audits/no-progress-signature-tool-calls-only-code-quality-2026-06-30.md`
- Golden rule: `rules/code-quality-golden-rule.md` § 1 (FAIL_SOFT may proceed with ADR), § 5 (D2 detector contract)
- Plan: `knowledge-base/plans/no-progress-signature-tool-calls-only-plan.md`
