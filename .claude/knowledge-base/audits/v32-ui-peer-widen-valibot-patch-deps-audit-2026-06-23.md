# Deps Audit: v32-ui-peer-widen-valibot-patch

**Date:** 2026-06-23 · **Mode:** plan-bound:v32 · **Verdict:** PASS · **Hard caps:** (none)

## Summary
- The plan FIXES a HIGH CVE (the whole point): valibot `^0.42.1` (GHSA-vqpr-j7v3-hqw9, HIGH ReDoS, affects <1.2.0) → `^1.4.1`.
- valibot@1.4.1 audit: 0 info / 0 low / 0 moderate / 0 high / 0 critical → clears the HIGH, introduces no new CVE.
- theokit peer widen (`^0.14.0`→`^0.14.0 || ^0.18.0`) adds no dependency.
- No NEW package introduced.

## Plan validation
| Plan dep | Section | Verdict |
|---|---|---|
| `@theokit/ui` `^0.14.0 || ^0.18.0` | Existing (widened) | OK — range change, additive |
| `valibot` `^1.4.1` | Bumped (security) | OK — fixAvailable; 0 vulns at 1.4.1; clears GHSA-vqpr-j7v3-hqw9 |

PASS — the plan resolves a HIGH and adds no new vulnerable surface. Proceed to /implement.
