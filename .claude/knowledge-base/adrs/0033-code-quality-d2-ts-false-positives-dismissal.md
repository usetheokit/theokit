# ADR 0033 — Dismiss D2-TS symbol-fab false-positives for agents-thinking-event-contract

**Status:** Accepted
**Date:** 2026-06-28
**Cycle:** agents-thinking-event-contract (Cycle 1 — `AgentThinkingEvent` contract variant)
**Context source:** `/code-quality agents-thinking-event-contract` verdict FAIL_SOFT (70)

## Context

`/code-quality` for this slug returns **FAIL_SOFT (70)** with these findings — all from D2 (symbol fabrication), all in files this change did NOT touch, surfaced by a whole-repo TS scan:

| Finding | File (untouched by this change) | Severity | Nature |
|---|---|---|---|
| `virtual:integration:banner` | `fixtures/define-integration/app/page.tsx` | SOFT_CAP (was HARD, allowlisted) | Vite virtual module (`virtual:` prefix), resolved by a Vite plugin at build time — NOT an npm package |
| `@theokit/sdk/retry` ×3 | `packages/agents/src/loop/{run-reflective-loop,agent-runner}.ts`, `bridge/agent-orchestrator.ts` | SOFT_FLOOR (`symbol_fab_unverifiable_typescript`) | `@theokit/*` workspace subpath; resolves in-tree; npm-registry probe is ambiguous for deep `exports` subpaths |
| `@theokit/sdk/compaction` | `packages/agents/src/loop/compaction-strategy.ts` | SOFT_FLOOR (`symbol_fab_unverifiable_typescript`) | same as above (workspace subpath) |
| `@theokit/http/runtime/node` ×2, `@theokit/ui/styles.css` | agents tests, create-theokit template | INFO (already allowlisted) | same class (workspace subpath) |

**Proof this is pre-existing, not introduced by this change:**
- `/code-quality` in STANDALONE mode (whole-repo, no plan) on the current tree returns the identical FAIL_HARD/8-findings result.
- This change (commit `c041666`) touches only `packages/theo/src/core/contracts/{agent-events,index}.ts`, `client/index.ts`, `server/agent/agent-types.ts`, and three test files. ZERO of the findings are in those files.
- The D2 detector documents TS support as "package-name check only; member-access introspection deferred" (`skills/code-quality/SKILL.md` Roadmap) — `symbol_fab_unverifiable_typescript` is the known limitation, not a defect.

## Decision

Dismiss the FAIL_SOFT soft caps for this cycle:

1. **SOFT_CAP `virtual:integration:banner`** — allowlisted in `code-quality-allowlist.txt` (HARD → SOFT_CAP). It is a Vite virtual module, not an npm package; the symbol resolves at build time via the fixture's Vite plugin. Dismissed.
2. **SOFT_FLOOR `symbol_fab_unverifiable_typescript`** (`@theokit/sdk/retry`, `@theokit/sdk/compaction`) — the documented D2-TS workspace-subpath limitation; both subpaths resolve in-tree (`@theokit/sdk` exports `./retry` and `./compaction`, consumed by the V4-B/V4-D loop runtime). Dismissed.
3. **INFO** (allowlisted `@theokit/http/runtime/node`, `@theokit/ui/styles.css`) — non-blocking; already covered by existing allowlist entries.

This change introduces **zero** new code-quality findings. The FAIL_SOFT is a pre-existing repo baseline driven entirely by D2-TS false-positives in untouched files.

## Alternatives considered

- **Fix the D2 detector to skip `virtual:` specifiers + introspect `@theokit/*` workspace subpaths** — the correct durable fix, but it modifies the shared code-quality skill detector (out of this slug's scope). Tracked as a code-quality detector follow-up. REJECTED for this cycle (scope).
- **`--no-code-quality` override** — would skip the gate entirely; less honest than allowlisting the specific false-positive + documenting the rest. REJECTED.
- **Allowlist all SOFT_FLOOR subpaths too** — unnecessary; they are non-blocking (cap 89) and this ADR dismisses them. REJECTED (avoid allowlist sprawl for non-blocking findings).

## Consequences

- `/review` may proceed on FAIL_SOFT per `cycle-review.md` Pre-conditions (FAIL_SOFT + ADR dismissing each soft cap).
- The allowlist entry sunsets 2026-09-20 (≤ 90 days); the durable fix is the D2 detector follow-up.
- No production code or contract behavior is affected by this ADR — it concerns the audit gate only.
