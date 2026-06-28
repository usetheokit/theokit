# ADR 0034 — Dismiss D2-TS symbol-fab false-positives for agents-reasoning-effort

**Status:** Accepted
**Date:** 2026-06-28
**Cycle:** agents-reasoning-effort (M1 — enable extended thinking via `reasoningEffort`)
**Context source:** `/code-quality agents-reasoning-effort` verdict FAIL_SOFT (70)

## Context

`/code-quality` for this slug returns **FAIL_SOFT (70)** with 8 findings — all from D2 (symbol fabrication), all surfaced by a whole-repo TS scan, **all pre-existing and identical to the baseline already dismissed in [ADR 0033](0033-code-quality-d2-ts-false-positives-dismissal.md)** (prior cycle `agents-thinking-event-contract`):

| Finding | File | Severity | Touched by M1? |
|---|---|---|---|
| `virtual:integration:banner` | `fixtures/define-integration/app/page.tsx` | SOFT_CAP (was HARD, allowlisted) | No |
| `@theokit/sdk/retry` ×3 | `packages/agents/src/loop/{run-reflective-loop,agent-runner}.ts`, `bridge/agent-orchestrator.ts` | SOFT_FLOOR (`symbol_fab_unverifiable_typescript`) | No¹ |
| `@theokit/sdk/compaction` | `packages/agents/src/loop/compaction-strategy.ts` | SOFT_FLOOR | No |
| `@theokit/http/runtime/node` ×2, `@theokit/ui/styles.css` | agents tests, create-theokit template | INFO (already allowlisted) | No |

¹ `agent-runner.ts` IS touched by M1, but the flagged `@theokit/sdk/retry` import is **pre-existing** (line 23). M1 added only a module-local relative import (`import type { ReasoningEffort } from '../types.js'`, line 34) — relative specifiers are never probed by D2.

**Proof this is pre-existing, not introduced by M1:**
- The 8 findings are byte-identical to ADR 0033's table (same files, same specifiers, same severities).
- M1 (commit `9c04863`) touches `packages/agents/src/{types.ts, index.ts, bridge/{agent-compiler,sdk-adapter,index}.ts, loop/agent-runner.ts}` + 3 test files. ZERO D2 findings reference any M1-authored symbol or import. The reasoning param is a string literal (`{ id: 'thinking', value: effort }`), not an import; the SDK type (`ModelSelection`) is imported from the verifiable `@theokit/sdk` barrel.
- The D2 detector documents TS support as "package-name check only; member-access introspection deferred" (`skills/code-quality/SKILL.md` Roadmap) — `symbol_fab_unverifiable_typescript` is the known limitation, not a defect.

## Decision

Dismiss the FAIL_SOFT soft caps for this cycle, on the same basis as ADR 0033:

1. **SOFT_CAP `virtual:integration:banner`** — allowlisted (HARD → SOFT_CAP); a Vite virtual module resolved at build time, not an npm package. Dismissed.
2. **SOFT_FLOOR `symbol_fab_unverifiable_typescript`** (`@theokit/sdk/retry`, `@theokit/sdk/compaction`) — the documented D2-TS workspace-subpath limitation; both subpaths resolve in-tree. Dismissed.
3. **INFO** (allowlisted `@theokit/http/runtime/node`, `@theokit/ui/styles.css`) — non-blocking; covered by existing allowlist entries.

M1 introduces **zero** new code-quality findings. The FAIL_SOFT is the pre-existing repo baseline driven entirely by D2-TS false-positives in untouched files.

## Alternatives considered

- **Fix the D2 detector to skip `virtual:` specifiers + introspect `@theokit/*` workspace subpaths** — the correct durable fix, but it modifies the shared code-quality detector (out of this slug's scope). Tracked as the same code-quality detector follow-up named in ADR 0033. REJECTED for this cycle (scope).
- **`--no-code-quality` override** — would skip the gate; less honest than dismissing the specific pre-existing findings with proof. REJECTED.
- **Allowlist the SOFT_FLOOR subpaths too** — unnecessary; they are non-blocking (cap 89) and this ADR dismisses them. REJECTED (avoid allowlist sprawl).

## Consequences

- `/review` may proceed on FAIL_SOFT per `cycle-review.md` Pre-conditions (FAIL_SOFT + ADR dismissing each soft cap).
- The `virtual:integration:banner` allowlist entry sunsets 2026-09-20 (≤ 90 days); the durable fix is the D2 detector follow-up.
- No production code or contract behavior is affected by this ADR — it concerns the audit gate only.
