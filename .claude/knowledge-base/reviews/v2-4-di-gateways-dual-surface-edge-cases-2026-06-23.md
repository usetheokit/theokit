# Edge Case Review — V2-4 di/gateways/dual-surface ADR

Date: 2026-06-23
Tasks analyzed: 3 (T1.1, T1.2, T2.1)
Edge cases found: 2 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 1)

## SHOULD TEST

### EC-1: the ADR must cite REAL file:line evidence (no fabricated citation)
- **Affected task:** T1.1 / T2.1
- **Family:** Citation
- **Scenario:** an ADR asserting "di is unused" or "M7 shipped defineHealthRoute" without the evidence resolving would be a post-rationalization. The ADR (unlike the plan) is not scored by plan-confidence, so the integrity check is manual.
- **Suggested test:** T2.1 re-greps every cited symbol (`defineHealthRoute`, `serverErrorToEnvelope`), the predecessor ADRs (0031/0030), and the theocode no-adoption claim. The review phase independently re-verifies.

## DOCUMENT

### EC-2: NotFoundException vs NotFoundError naming
- **Accepted risk:** the gap-audit snapshot named the typed-404 `NotFoundException` (NestJS style); the shipped name is `NotFoundError`. The ADR records the canonical name (`NotFoundError`) and notes the snapshot's name was aspirational — a factual correction, surfaced as a residual note, not hidden.

## Summary
| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 0 | 1 | 1 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK
