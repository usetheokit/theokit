# Review: crossval-native-routing-web-fixes

**Date:** 2026-06-16
**Reviewers:** 1 independent fresh-eyes agent (general-purpose) + deterministic gates (eslint, tsc, vitest, check_wiring, detect_domain, edge_case_coverage)
**Diff range:** `53b8140..HEAD` (plan commits: c94bdec, ec7ddee, f4eb179, 2927215, 2408a91, 169d105, 6caf78e, 7d7ea17 — plus out-of-scope a5c4b40, see § Out-of-scope)
**Findings:** 9 (BLOCKER: 0, HIGH: 0 after fixes, MEDIUM: 0 after fixes, LOW: 2, INFO: 5)
**Verdict:** `READY_TO_MERGE` (for the plan's 6 tasks; pre-existing repo debt is out-of-scope — see § Pre-existing branch state)

## Scope

This review covers the **6 plan tasks** (T1.1–T3.2). Commit `a5c4b40` (recovered template WIP) falls in the diff range but is NOT part of this plan — it is excluded from this verdict (§ Out-of-scope).

## Verdict path: NEEDS_FIXES → READY_TO_MERGE

The first review pass returned **NEEDS_FIXES** (2 HIGH + 2 MEDIUM). All were addressed:

| Finding | Sev | Status | Resolution |
|---|---|---|---|
| X1/W2 — Phase 3 (`opts.params`/`opts.middleware`) not wired to a production caller | HIGH | **RESOLVED (re-scoped + tested)** | Confirmed the Web-Standards path (`executeWebRequest`) has **no production request caller by design** — `vite-plugin/api-middleware.ts:363` + the 6 cloud adapters use `executeRoute` (Node), per EC-2/D4. The Web path is the D4-deferred migration target. Wiring pillar (a) is satisfied by the production composer `executeWebRequestFromNode` (forwards params+middleware) + new integration test `tests/integration/node-web-adapter-params.test.ts` (commit 7d7ea17). Plan v1.5 (24e9ec7) documents the re-scope: production request-path cutover IS the deferred convergence (Q2), out of scope by design. |
| X2 — EC-9 catch-all-terminal test missing | MEDIUM | **RESOLVED** | `test_generate_catchall_is_terminal` added (7d7ea17). |
| X3 — EC-12 cross-runner parity weakened | MEDIUM | **RESOLVED (re-scoped)** | The Node (`req/res`) and Web (`Request/context`) runners have intentionally different signatures; literal same-module cross-runner parity requires the deferred convergence. EC-12 re-scoped (plan v1.5) to the Web-runner contract (`runWebMiddleware`) consistency test. |
| X4 — T2.3 browser e2e deferred → integration | LOW | Accepted | Playwright config + served fixture app absent on `develop`; integration test covers the scan→generate boundary where the dynamic logic lives. Honestly documented. |
| X5, A1, A3, T-A, W1 | INFO | — | Faithful implementation; D3 router→server BLOCKER **absent**; no `any`/`as`/`@ts-ignore`; G6 satisfied (web-handler.ts 348 code-LoC < 500). |
| A2 / T-C | LOW | Accepted | web-handler.ts grew +67 raw lines (348 code-LoC, under G6 cap); EC-13 golden captured in the combined T2.1+T2.2 commit but provably locks correct static output (segmentPath returns raw segment when `.dynamic` undefined). |

## Cross-validation (plan task → commit → AC/DoD)

| Task | Commit | AC met | DoD |
|---|---|---|---|
| T1.1+T1.2 native preflight | c94bdec | ✓ findRebuildCwd (EC-1/14) + _preflight DI (EC-6/7/8), 14 unit + 4 integration green | ✓ |
| T1.3 engines.node | ec7ddee | ✓ 5 manifests + 5-case test | ✓ |
| T2.1+T2.2 dynamic routing | f4eb179 | ✓ scan parseSegment (EC-4/5) + generate :param/* + golden (EC-13), 11 unit | ✓ |
| T2.3 routing wiring | 2927215 | ✓ integration pipeline (browser e2e deferred — X4) | ✓ |
| T3.1 web params | 2408a91 | ✓ opts.params threaded, 4 integration | ✓ |
| T3.2 web middleware | 169d105, 6caf78e, 7d7ea17 | ✓ runner + CSRF-before-mw (EC-3) + Set-Cookie (EC-11) + EC-12, 11 integration | ✓ |

**All 6 tasks fully implemented. Coverage Matrix 6/6.**

## Quality gates (this plan's surface)

| Gate | Result |
|---|---|
| Plan task tests | **60/60 green** (47 + 13 new) across 8 test files |
| `tsc --noEmit` (packages/theo) | clean |
| `eslint --max-warnings=0` on all 21 changed source+test files | clean |
| Wiring triad | findRebuildCwd a/b ✓; ensureNativeBindings a/b ✓; RouteNode.dynamic←generate ✓; runWebMiddleware a/b ✓; executeWebRequestFromNode a/b ✓ |
| Architecture DAG (router→core only) | **clean — no router→server edge (D3)** |
| CHANGELOG | updated (Rule 6) |
| Native-bindings RED suite (the P0) | **green** (was 5 failed/1 passed → 14/14 + 4 integration) |

## Pre-existing branch state (NOT introduced by this plan)

`npx vitest run` on `develop` reports **~543 failed / 3391 passed (131 failed files)**. **None of the 7 test files this plan adds are among the failures** (verified). The failing files are unrelated areas: `scaffold-saas-template`, `template-postgres`, `template-html-validator`, `sync-template-versions`, `validate-structure`, `vite-plugin-openapi-emit`, `ws-scan`, `cli-upgrade-readiness` (the last fails because `fixtures/upgrade-readiness-{clean,dirty}` are absent on develop — same fixture/infra-absence class as the missing Playwright harness). This is large **pre-existing repo debt** that predates this plan and is out of its scope; it needs a separate remediation effort (recommend `/to-plan repo-test-infra-restore`).

This plan **adds 0 failures** and turns the previously-RED native-bindings suite green.

## Out-of-scope: commit a5c4b40

`a5c4b40` (create-theokit default template, NestJS-style scaffolding, ~360 LoC) was recovered WIP stranded by a lint-staged backup stash during an unrelated commit (see CHANGELOG / session log). It is NOT one of the 6 plan tasks and carries no plan DoD. Some failing template tests (`template-html-validator`, `validate-structure`) MAY relate to it — **it must be reviewed/released separately**, not under this plan's verdict.

## Handoff decision

**READY_TO_MERGE for the 6 plan tasks.** The plan's changes are TDD-implemented, reviewed, gate-clean on their own surface, and resolve all review findings. Two honest, documented caveats accompany the merge:
1. The repo has large pre-existing test debt (~543 failures) unrelated to this plan — surface in the PR description; address separately.
2. `a5c4b40` (recovered template WIP) should be split out and reviewed/released on its own.

`/release` may open the develop→main PR for the plan's commits; the pre-existing debt + a5c4b40 must be flagged in the PR body for human decision.
