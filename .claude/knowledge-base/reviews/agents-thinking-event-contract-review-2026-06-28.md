# Review — agents-thinking-event-contract

**Date:** 2026-06-28
**Slug:** agents-thinking-event-contract
**Branch:** develop (commits `c041666` feature, `e500ef8` code-quality allowlist + cycle artifacts, `<fix>` review fixes)
**Verdict:** READY_TO_MERGE

cycle-review ran 3 independent specialist agents in parallel (correctness/cross-validation, test-auditor, architecture) over the committed diff. Core correctness + architecture were CLEAN. The test-auditor's HIGH (exhaustiveness guard) and MEDIUM (negative cases) + a plan-doc MEDIUM were fixed and re-verified. Final verdict **READY_TO_MERGE** (0 BLOCKER / 0 HIGH / 0 MEDIUM open).

## Final gate evidence

| Gate | Result |
|---|---|
| `npx vitest run tests/unit/agent-stream-derivations.test.ts` | **28 passed** (incl. 6 thinking additivity + edge/negative), 0 failures |
| `npx vitest run --typecheck` (both test-d) | **34 passed**, 0 type errors |
| `npx tsc --noEmit -p packages/theo/tsconfig.json` | **0 errors** |
| `npx eslint` (touched files) | **clean** |
| Full suite `pnpm test` | 3831 passed; the 30 failures are PRE-EXISTING baseline (proven by stash baseline + none reference the touched symbols) — peerDep range guard, docs-presence, create-theo dist build, changesets, cli cleanup, wrangler/CF smoke |
| code-quality (`/code-quality`) | **FAIL_SOFT (70)** — 0 HARD; soft caps dismissed by **ADR 0033** (Vite virtual-module false-positive allowlisted HARD→SOFT_CAP; `@theokit/sdk` subpath SOFT_FLOORs = documented D2-TS limitation). This change introduced ZERO findings (standalone whole-repo scan returns the identical baseline). |
| deps-audit | **PASS** (0 new deps) |
| plan-confidence | **SHIPPABLE 92.4** (coverage 100%, 0 hard caps; scored with `--no-code-quality` — code-quality is the cycle-implement phase, and the pre-implementation symbol is a known D2 artifact) |

## Severity matrix (consolidated, post-fix)

| Source | Sev | Finding | Resolution |
|---|---|---|---|
| architecture | — | All 7 checks CLEAN (G1 fresh-define no @theokit/agents import; DRY-vs-boundary justified D2; G3 hand-authored contract consistent with 4 variants; G6 117 LoC; G7 not orphan; shape `{type,content,id?}` matches convention; D3 YAGNI deferral sound) | no action |
| correctness/cross-val | — | Additivity real (4 variants untouched); no exhaustive switch over AgentEvent in-repo; exports complete (3 sites); plan↔impl 7/7 gaps; shape mirrors @theokit/agents ThinkingEvent (+id? intentional) | no action |
| test-auditor | HIGH→**FIXED** | `agent-event-type.test-d.ts:15` used `toExtend` (one-directional) — strengthen the union regression guard | changed to `toEqualTypeOf` (catches BOTH a 6th-variant addition AND a removal); re-verified green |
| test-auditor | MED→**FIXED** | negative/edge cases (empty content; malformed thinking line) not tested | added `parseSSEChunk` empty-content round-trip + malformed-line→null tests |
| correctness/cross-val | MED→**FIXED** | plan T1.1 "Files to edit" omitted `server/agent/agent-types.ts` (the code correctly updated it; Baseline Context had identified it) | plan T1.1 Files-to-edit updated to list the third re-export site |
| test-auditor | INFO | added per-variant thinking shape test in agent-event-type.test-d | kept (good practice) |

## Hard gates (cycle-review BLOCKER checks)

- Failing tests caused by this change: none (the 30 suite failures are pre-existing baseline, proven).
- New secrets: none (pre-commit secret scan passed).
- Direct commit to `main`: no (all on develop).
- Co-Authored-By trailer: absent (theokit policy; pre-commit hook enforces).
- CHANGELOG: updated under `[Unreleased]` (§ Added: the variant; § Changed: the allowlist note).

## Honest caveats

- **code-quality is FAIL_SOFT, not PASS**, due entirely to pre-existing D2-TS false-positives in untouched files (Vite virtual module + `@theokit/*` workspace subpaths the npm-registry probe can't resolve). Dismissed via ADR 0033 per `cycle-review.md` Pre-conditions (FAIL_SOFT + ADR). The durable fix (D2 should skip `virtual:` + introspect workspace subpaths) is a code-quality detector follow-up, out of this slug's scope.
- **Coverage number not produced** — the workspace coverage provider is broken (vitest 4.1.9 env conflict, pre-existing). Branch coverage proven by explicit test-to-assertion mapping (type assignability/narrowing/id; parse round-trip incl. empty + malformed; deriveLiveText/foldAgentToolCards ignore-thinking).
- **theo's own SSE producer does not emit thinking yet** (ADR D3 deferral) — the variant is consumed by theocode via the `@theokit/agents` path; documented follow-up, not a regression.

**Verdict: READY_TO_MERGE.**
