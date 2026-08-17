# ADR 0035 — Dismiss D2-TS symbol-fab false-positives for agents-think-tag-middleware

**Status:** Accepted
**Date:** 2026-06-28
**Cycle:** agents-think-tag-middleware (M2 — `<think>`-tag reasoning middleware)
**Context source:** `/code-quality agents-think-tag-middleware` verdict FAIL_SOFT (70)

## Context

`/code-quality` for this slug returns **FAIL_SOFT (70)** with 8 findings — all from D2 (symbol fabrication), all surfaced by a whole-repo TS scan, **all pre-existing and byte-identical to the baseline already dismissed in [ADR 0033](0033-code-quality-d2-ts-false-positives-dismissal.md) and [ADR 0034](0034-code-quality-d2-ts-false-positives-dismissal-reasoning-effort.md)**:

| Finding | File | Severity | Touched by M2? |
|---|---|---|---|
| `virtual:integration:banner` | `fixtures/define-integration/app/page.tsx` | SOFT_CAP (allowlisted) | No |
| `@theokit/sdk/retry` ×3 | `packages/agents/src/loop/{run-reflective-loop,agent-runner}.ts`, `bridge/agent-orchestrator.ts` | SOFT_FLOOR (`symbol_fab_unverifiable_typescript`) | No¹ |
| `@theokit/sdk/compaction` | `packages/agents/src/loop/compaction-strategy.ts` | SOFT_FLOOR | No |
| `@theokit/http/runtime/node` ×2, `@theokit/ui/styles.css` | agents tests, create-theokit template | INFO (allowlisted) | No |

¹ `agent-runner.ts` IS touched by M2 (added the `parseThinkTags` option + forward), but the flagged `@theokit/sdk/retry` import is **pre-existing** (line 23) — M2 added no new external import to it.

**Proof this is pre-existing, not introduced by M2:**
- The 8 findings are byte-identical to ADR 0033/0034's tables (same files, same specifiers, same severities).
- M2 (commit on develop) adds one NEW module — `packages/agents/src/bridge/think-tag-extractor.ts` — which imports ONLY the local `StreamEvent` type (`from './agent-sse-handler.js'`, relative). Relative specifiers are never probed by D2; the new module is NOT in the findings list.
- The D2 detector documents TS support as "package-name check only" (`skills/code-quality/SKILL.md` Roadmap) — `symbol_fab_unverifiable_typescript` is the known `@theokit/*` workspace-subpath limitation, not a defect.

## Decision

Dismiss the FAIL_SOFT soft caps for this cycle, on the same basis as ADR 0033/0034:

1. **SOFT_CAP `virtual:integration:banner`** — allowlisted; a Vite virtual module, not an npm package. Dismissed.
2. **SOFT_FLOOR `symbol_fab_unverifiable_typescript`** (`@theokit/sdk/retry`, `@theokit/sdk/compaction`) — the documented D2-TS workspace-subpath limitation; both resolve in-tree. Dismissed.
3. **INFO** (allowlisted `@theokit/http/runtime/node`, `@theokit/ui/styles.css`) — non-blocking; covered by existing allowlist entries.

M2 introduces **zero** new code-quality findings. The FAIL_SOFT is the pre-existing repo baseline.

## Alternatives considered

- **Fix the D2 detector to skip `virtual:` specifiers + introspect `@theokit/*` workspace subpaths** — the correct durable fix, tracked as the code-quality detector follow-up named in ADR 0033; out of this slug's scope. REJECTED for this cycle.
- **`--no-code-quality` override** — less honest than dismissing the specific pre-existing findings with proof. REJECTED.

## Consequences

- `/review` may proceed on FAIL_SOFT per `cycle-review.md` Pre-conditions (FAIL_SOFT + ADR dismissing each soft cap).
- The `virtual:integration:banner` allowlist entry sunsets 2026-09-20; the durable fix is the D2 detector follow-up.
- No production code or contract behavior is affected by this ADR — it concerns the audit gate only.
