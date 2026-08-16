# crossval-4-6-absorption — implementation summary

**Status:** Phases 0–4 complete (17 of 18 tasks); **Phase 5 not started — blocked on the release gate.**
**Date:** 2026-08-16
**Branch:** `workspace`, across three repositories (`theokit`, `theokit-sdk`, `theokit-tui`).

## What shipped

| Phase | Tasks | Outcome |
|---|---|---|
| 0 — the guard | T0.1 | The capability-index guard follows `export *` one hop. Without it, 38 forwarded names were reported ABSENT — the false measurement that sent the original cross-validation chasing a re-export that already existed. |
| 1 — reachability | T1.1, T1.3 (T1.2 blocked) | The base error class is pinned reachable from the published `dist`. The MCP OAuth flow (286 tested lines, exported by nothing) got the `@theokit/sdk/mcp-auth` barrel. |
| 2 — half-crossed capabilities | T2.1–T2.7 | The auto-approve rule became callable per event; session deletion's registry half became reachable and ordered registry-first; the backtrack fork stopped silently picking the wrong turn; two directories under `~/.theokit` stopped being born group-writable; `sinceMarker` stopped matching prose. |
| 3 — absorption | T3.1–T3.4 | Tool name→presentation maps, the liveness oracle, the custom-command template expander, the centred window anchor and the capability-derived keyboard help. |
| 4 — keeping it true | T4.1–T4.3 | Three gates: the layer-invention gate, the doorless-subpath decision table, and the consumer-gap `closes:` convention. |

## Blocked

**T1.2 — the image tool.** `@theokit/sdk-tools@0.26.3` was published 2026-08-11; `createViewImageTool`
was committed 2026-08-14 (`897b6d75b`) with no version bump. Every published 0.26.x was fetched and
checked: none ships the symbol. The layer is not withholding it — its dependency does not publish it.
The four assertions `skipIf` with a loud warning and reactivate the moment a version carrying it is
installed. `theokit-sdk` has `0.27.0` prepared behind the release gate.

**Phase 5 (T5.0–T5.4) — the TheoCode adoption.** T5.0 is a blocking checkpoint: the new versions must
resolve on the npm registry. Measured 2026-08-16:

| Package | Published | Local source | Gap |
|---|---|---|---|
| `@theokit/agents` | 9.4.0 | 9.4.0 | every Phase 0–4 change is above it, unversioned |
| `@theokit/tui` | 0.53.0 | 0.53.0 | T3.1 + T3.4 above it, unversioned |
| `@theokit/sdk` | 4.52.1 | 4.52.1 | T1.3 + T2.5 + T2.4 above it, two changesets prepared |

`TheoCode/packages/agent/package.json` pins `"@theokit/agents": "^9.4.0"` — the published 9.4.0, which
contains none of this work. Starting consumer edits against unpublished code produces a branch that
cannot be verified and a false sense of completion, which is precisely what T5.0 exists to prevent
and what the 2026-08-15 audit already ended on.

**The gate is human-owned by contract, not by caution.** `rules/cycle-release.md` locks the chain
`workspace → PR → develop → PR + semver tag → main`, with the PR approval a hard gate under
Unbreakable Rule 4. Publishing from this session would bypass a gate the repository declares
unbypassable, so it was not attempted.

## Deviations from the plan, each recorded where it happened

- **T3.2 / EC-9.** The plan expected a symlink cycle to yield `undetermined`, reasoning it burns the
  budget. De-duplicating candidates makes it terminate on distinct entries instead, so the verdict is
  `dead` by contract. Recorded in the test with the reasoning; the budget-genuinely-spent half is now
  its own test.
- **T3.4.** The plan proposed a new `windowAround`. There was already exactly one implementation of
  that clamp, exported and consumed, so the anchor became an OPTION on it — a sibling would be two
  implementations of one rule (G12). The default is unchanged behaviour.
- **T4.2.** Nothing was bulk-forwarded. 25 doorless subpaths each got a written decision with its
  measurement instead, because 25 new exports with no consumer is what G7 and G11 forbid.
- **T2.4.** The Q3 proposal named five creators as reaching the shared tree; two do not
  (`task/store.ts` takes its directory from the caller, `lance-index.ts` builds the PROJECT's
  `.theokit`). Correction recorded in the plan.

## Tooling changed to keep a gate honest

`check_checkpoint_consistency.py` reported a cross-repo SHA as "fabricated or stale". It was neither
— it was unverifiable, and the check could not tell the two apart. A task may now declare `repo`, and
the SHA is verified THERE. The four tests that must still fail (repo that is not a repository, repo
that does not exist, SHA absent there, bad SHA with no repo) were all green before the
implementation, so only the legitimate case was red — which is the evidence that this widened the
check rather than weakening it.

## Verification

- `packages/agents` unit suite: 1182 passed, 3 skipped, no type errors.
- `theokit-tui` full suite: 1451 passed, 1 skipped.
- `theokit-sdk` full suite: exit 0.
- Workspace typecheck: clean.
- Phase-boundary mini reviews: phase 0 PASS, phase 1 NEEDS_FIX (T1.2 blocked — honest), phase 2 PASS,
  phase 3 PASS.
- Phase 4 returned NEEDS_FIX on one HIGH: `wiring_pillar_a_fail` for `DOORLESS_DECISIONS`, whose only
  consumer was its own test — the same lesson phase 0 taught. Fixed by giving it the caller that
  should have existed: `check-surface-parity.mjs` now reports the doorless half of the boundary
  alongside the half it can compare. `findUnreachableEnforcement` and `missingCloses` then failed
  pillar (b), closed by `tests/integration/tooling-gates-cli.test.ts`, which runs each gate as a
  consumer meets it and cross-checks the CLI's verdict against the pure function.
- **Stated precisely:** after those fixes, `check_wiring.py` — the script the mini review aggregates
  for this check — returns PASS on all four Phase 4 symbols (`DOORLESS_DECISIONS`,
  `declaredExportsFromText`, `findUnreachableEnforcement`, `missingCloses`). The AGGREGATE phase-4
  re-run did not complete on this machine: it re-runs the full code-quality audit and repeatedly
  exceeded the available window. So the finding is verified resolved with the underlying check, and a
  fresh `PHASE_REVIEW_PASS` token was NOT emitted and is not claimed here. `/review` re-runs it.
- `check:invention-reachability`, `check:changelog-closes`, `crossval-gaps` (33), boundary decisions
  (5): all green.

## Next step

`/review crossval-4-6-absorption`. The release, and with it Phase 5, needs the human-approved PR chain.
