# Review — V2-4 di/gateways/dual-surface strategic ADR (theokit)

**Date:** 2026-06-23 · **Slug:** v2-4-di-gateways-dual-surface
**Commit:** `20fe3c7` (docs-only — ADR 0032 + cycle artifacts + CHANGELOG)
**Reviewers:** 2 independent agents (evidence+verdict soundness · consistency+DoD+cross-validation)
**Code-quality:** FAIL_HARD — but PRE-EXISTING theokit `.ts` repo findings; the V2-4 diff is docs-only (7 `.md` files, zero source), so it does not gate this ADR (both reviewers verified the diff is docs-only and the framing honest).
**Verdict:** **READY_TO_MERGE** (0 BLOCKER, 0 HIGH, 0 MEDIUM, 0 LOW; 2 INFO)

## What shipped
ADR 0032 — the final V2-4 verdict, grounded in the V2 adoption evidence ADR 0031 explicitly lacked:
1. **di / di-agent / orm / gateways stay EXTERNAL + opt-in** — the boundary set by ADR 0031 + theokit-sdk `revoke-decorators-mandatory` is correct and final; no re-absorption, no further extraction.
2. **The imperative/factory-first on-ramp is the canonical, complete path.**
3. **The dual HTTP surface is RESOLVED** — convention dev-server is PRIMARY (M7 0.8.1 gave it typed health/ready + typed errors + socketless boot); `@theokit/http` `TheoApp` is the embedding surface.
4. Residual follow-ups tracked as non-blocking Consequences.

## Independent evidence verification (both reviewers, reproduced)
| Claim | Verdict |
|---|---|
| theocode adopts NONE of di/di-agent/orm/gateways/decorators | ✅ deps = sdk/sdk-tools/ui/theokit only; ZERO real imports; the single grep hit is the prompt string at `code.prompt.ts:175` |
| imperative on-ramp (Agent.create/defineTool/agent.send) | ✅ 57× in server/; `agent-stream.ts:314` |
| M7 symbols cited resolve | ✅ `defineHealthRoute`/`defineReadyRoute` (`health-route.ts:49,59`), `TheoError`/`fromUnknown`/`NotFoundError` (`theo-error.ts`), `serverErrorToEnvelope` (`web-handler.ts:265`) |
| `NotFoundException` absent, `NotFoundError` present (ADR's naming correction) | ✅ confirmed |
| consumer counts: orm 2 plugins, di/di-agent 0 V2 consumers, gateways 11 pkgs / no real consumer | ✅ precise, not overstated |
| continues ADR 0031, upholds 0030 + theokit-sdk `revoke-decorators-mandatory` (no contradiction) | ✅ continuation, not reversal |
| DoD: Decision×1, ≥3 alternatives, Status/Date/Milestone, CHANGELOG refs 0032 | ✅ all present |
| 0032 is the correct next ADR number | ✅ (last = 0031) |
| commit hygiene (docs-only; no .ts / examples / __pycache__ / stray docs) | ✅ 7 `.md` files only |

## Verdict soundness (judged, not assumed)
- "Dual-surface RESOLVED" is **honest, not overstated**: the capability gap is genuinely closed in code; the two residuals (readiness-probe wiring TODO at `start/index.ts:120-124`; theocode on `theokit ^0.5.4` still hand-rolling `health.ts`) are correctly scoped as non-blocking consumer/follow-up items, not framework gaps.
- Rejected alternatives are real trade-offs (re-absorb / delete-unused / TheoApp-primary / defer-again), each tied to the evidence + KISS/YAGNI + the four-pillar split — not strawmen.
- The verdict **follows from** the evidence and **ratifies** the prior ADRs with the data they lacked.

## Findings
- **INFO-1:** two `theocode` working copies exist (V2 `/usetheo/theocode` SDK ^2.5.0; legacy `theokit-tools/theocode` SDK ^1.9.0) — the ADR pins the exact path it cites and labels the other "legacy pre-V2," so it is precise; noted for future readers.
- **INFO-2:** the ADR cites the cross-repo SDK ADR by conceptual name `revoke-decorators-mandatory` (on-disk `D431-…`); unambiguous, resolves. No action.

No BLOCKER/HIGH/MEDIUM/LOW.

## Conclusion
An evidence-grounded strategic verdict that closes the gap-audit's M8-4 question: every load-bearing claim was independently re-verified (no fabricated citation), the verdict follows from the data and ratifies (does not reverse) ADRs 0031/0030 + theokit-sdk `revoke-decorators-mandatory`, and the dual-surface resolution is honest about its residuals. **READY_TO_MERGE.**
