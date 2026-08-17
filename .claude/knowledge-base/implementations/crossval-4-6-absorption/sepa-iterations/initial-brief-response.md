# SEPA initial brief — `crossval-4-6-absorption`

Date: 2026-08-16 · Verdict: **PROCEED_WITH_NOTE**
Consulted at `/implement` Step 2.5. Read-only; wrote no code.

> Context correction the SEPA made and the orchestrator confirmed: the implementation contract's task table said all 23 `pending`; the tree says 17 committed / 6 blocked. The brief is therefore half forward-looking and half POST-GREEN on code that already exists.

## BLOCKER — T3.2 absorbed the plan's pseudo-code, not the consumer's algorithm

**Status: CONFIRMED by the orchestrator, by execution, not by reading.** Blocks T5.3.

The consumer answers liveness in two steps (`TheoCode/packages/agent/src/session/liveness-oracle.ts:64-80,109-166`): (a) `recordedCwd` reads the `cwd` field from the first line of up to 3 transcripts in the project dir — the path that resolved **91 of 120** sampled projects per its own docstring at `:28-33`; (b) only on a miss, a budgeted DFS from `/` with prefix pruning.

`packages/agents/src/session/liveness-oracle.ts` has neither. Three independently sufficient defects:

**1. `likelyPath` does not round-trip any path containing a hyphen.** `encodeProjectDir` maps every non-alphanumeric to `-` (`:57`); `likelyPath` maps every `-` back to `/` (`:65-67`). Proven by execution:

```
encoded : -home-paulo-Projetos-theo-theokit-framework
likely  : /home/paulo/Projetos/theo/theokit/framework
round-trips? false
```

The fast path misses on exactly the tree that motivated the absorption.

**2. `listProjects` means two different things in the two repos.** The consumer's `PlanAllOptions` (`gc/all-sessions.ts:44-52`) declares `listProjects: () => string[]` **alongside a separate `classify: (project: string) => Liveness` seam** — so `listProjects` yields *encoded directory names* and classification is injected independently. The framework's `classifyProjects` treats the same-named seam as yielding *real cwd paths*: it calls `encodeProjectDir(candidate)` at `:127` and `probe(candidate)` at `:129`. Pass the consumer's existing enumerator through in T5.3 and `encodeProjectDir(encodedName)` is the identity → the name matches → `probe` stats a bare relative name that does not exist → falls through.

**3. Falling through returns `dead`, including on an empty pool** (`:137-139`): `return remaining <= 0 ? undetermined : { liveness: 'dead', … }`. "The product's enumerator gave me nothing" classifies as DEAD.

Combined, (2) + (3) mean **every project on the machine classifies `dead`** — on the GC deletion path. D4's own rationale says deleting on could-not-tell is data loss, and the plan's T3.2 invariant says `UNDETERMINED` must never collapse to `DEAD`.

`test_framework_oracle_classifies_the_real_tree_identically()` (T5.3) cannot pass by construction. **This is a plan-level defect** — the plan's pseudo-code (`:1391-1408`) re-specified the consumer's algorithm lossily — so it returns to `cycle-plan`, not to a GREEN-phase fix (`cycle-implement.md § Stop conditions` #3).

## HIGH

**T1.2's closure assertion is `skipIf`, and gap 15 is counted closed anyway.** `packages/agents/tests/unit/tools-view-image-parity.test.ts:39-67` is honest about why (`sdk-tools` committed `createViewImageTool` at `897b6d75b` with no version bump; installed `0.26.1` lacks it), but `tools-entry.ts:18-20` still asserts "93 symbols, parity identical" with no withholding reason. **A skipped assertion is not a green assertion** — T5.4's 17/17 must count skips as not-green or it reproduces the vacuous-guard defect T0.1 exists to kill.

**T5.0 verifies three packages; the blocker is a fourth.** The plan's barrier (`:1889`) checks `@theokit/agents`, `@theokit/tui`, `@theokit/sdk`. T1.2 waits on `@theokit/sdk-tools@0.27.0`, after which `@theokit/agents` must bump its dependency and regenerate `tools-entry.ts`. Add it to the barrier or T1.2 stays silently open through Phase 5.

**T5.3 off-by-one, latent and silent.** Framework `forkBeforeUserTurn` is 1-based (`session-lifecycle.ts:296-300`); the consumer's `truncateRecordsBeforeUserTurn` is **0-based** (`TheoCode/.../backtrack.ts:106,111`). Retargeting without `+1` lands one turn early on every rewind — re-introducing the exact silent-wrong-turn failure T2.3 closed. Evidence it happened: the equivalence test passing on a 1-turn fixture rather than a ≥3-turn one.

**Single-pass claim is true for file/shell output, false for arguments.** `config/command-template.ts:26-27,120-130` — `$N` substitution runs *before* the reference scan, so an argument containing `` !`curl … | sh` `` executes. The consumer does the same, so this is faithful absorption rather than a regression — but the module's prose says the property is "structural, not filtered", which overclaims. Under G10, name the boundary in one sentence: arguments are trusted-by-construction only while a human types the invocation.

## MEDIUM

- **T3.4 ships two shapes for one idea.** `keyboardHelpFor` returns `{key,label}` (`keyboard-help-model.ts:25-28`) while the package's own panel consumes `{keys,description}` (`keyboard-help.tsx:12-17`) — the derived list cannot be rendered by its own component, and `DEFAULT_COMPOSER_SHORTCUTS` is still the hand-written literal the new module says must not exist. Also leaves pillar (a) without a natural caller inside `theokit-tui`.
- **T2.7 shipped half its contract and inverted EC-20.** `threadOf`/`byThread` are absent (`ask/pending-ledger.ts:76` takes no options) while the Coverage Matrix still claims them; and `:85` (`if (settled.has(id) || open.has(id)) continue`) keeps the **first** payload where EC-20 required keeping the latest. Genuine tension with the anti-resurrection rule — resolve deliberately (merge payload for `open`, keep ignoring `settled`).
- **`toolPresentation()` returns an object cast `as ReadonlyMap` whose `get` never returns `undefined` while `has` still returns `false`** (`theokit-tui/src/tool-presentation.ts:305-331`). Two exported values of the same declared type behave differently — LSP violation on a published type.
- **`KNOWN_TOOL_NAMES` omits `view_image`** (`:34-55`). If T1.2 lands, `defaults_cover_every_shipped_tool_name()` becomes false. Two tasks, two repos, no test spanning them — the drift the file's own comment predicts.
- **Three `command-template` divergences** that will surface at T5.2 as "the expander doesn't match": `$ARGUMENTS` unsupported (expands to the literal, the exact leak the plan forbids for `$N`), last-placeholder-absorbs-remaining missing, no-placeholder-appends-rawArgs missing; inlined content unfenced; `:150` compares UTF-16 code units while warning "bytes".
- **T2.4 residuals:** `ensureSecureDir` only repairs `dirname(filePath)`, so a pre-existing 0775 `~/.theokit` *above* the leaf is refused but never repaired; and `providers/catalog-source-models-dev.ts:59` creates a `homedir()`-rooted cache with a bare `mkdirSync` — verify it sits outside the checked tree before calling T2.4 complete.

## What held — recorded so the next review does not re-derive it

- **T2.1 / B-006 holds.** `bridge/approval-decision.ts:88` (`posture?.enforced === true`) and `:85` (unknown tool refused under `auto-edit`); `applyPosture` delegates (`approval-posture.ts:180`). One smell: a sentinel `'*'` is passed for an argument `full-auto` ignores.
- **T2.4's 0700 decision is honoured where it matters.** `hooks/secure-store.ts:54-72` mkdirs with mode **and** repairs a loose pre-existing dir, wired into `session-pointer.ts:99`, `project-index.ts:82`, `trust-store.ts:162`, SDK `jsonl.ts:142`, `credential-store.ts:257-258`. The refusal names `chmod 700 <dir>` (`credential-store.ts:127`) — "repair or refuse with the command named" satisfied.
- **T2.2 is clean.** Registry-first ordering documented (`session-lifecycle.ts:242-247,250-268`); EC-8 holds because the result is constructed after the race and never mutated; the `Promise.race` attaches a handler so a late rejection is not unhandled.
- **T2.3's DRY requirement held** — one predicate (`isGenuineUserTurn:373`) feeds one scan (`reachableUserTurns:381`), so previews and fork cannot disagree. **But EC-5's typed-error requirement did not**: `:297` and `:318` are two `TheokitAgentError`s with different strings, where the plan named `InvalidTurnOrdinalError` and `ReachableTurnsExceededError`. A caller cannot branch on them (`rules/error-handling.md § 2`).
- **T0.1/T4.1 DRY held** — one parser at `scripts/lib/declared-exports.mjs:62`, imported by both `crossval-gaps.test.ts:39` and `check-invention-reachability.mjs:20`.
- **Pillar (a) deferrals are correct**, not gaming: `transcript-root-hint.ts`, `liveness-oracle.ts`, `command-template.ts`, `approval-decision.ts` have no in-repo caller until T5.1–T5.3.
