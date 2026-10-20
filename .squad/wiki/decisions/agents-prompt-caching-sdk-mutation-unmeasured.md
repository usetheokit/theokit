# Proceed past the theokit-sdk mutation soft cap for B-412

- Status: accepted
- Date: 2026-10-20
- Item: B-412 (`agents-prompt-caching`), Step 5.8 code-quality audit of the theokit-sdk half
- Decided by: the session, under the S-003 sprint authority (delegated), on the precedent below

<!-- ADR-DISMISS-SOFT-CAP: auditor_unavailable_d4: theokit-sdk's Stryker config is the B-026 spike, meant to run from packages/sdk and writing reports/mutation/slice.json; D4 runs it from the repository root and reads reports/mutation/mutation.json, which is never written, so no mutation measurement exists for any theokit-sdk item -->

## Context

`item_code_quality.py agents-prompt-caching` wrote two audits on 2026-10-20. The theokit-sdk one
(`.squad/records/audits/agents-prompt-caching.theokit-sdk-code-quality-2026-10-20.md`) returned
FAIL_SOFT with no hard cap and one soft cap, `auditor_unavailable_d4`: "stryker ran but wrote no
report at reports/mutation/mutation.json". `check_upstream_gate.py` exits 1 on it.

The cause is the one human/paulo decided for B-380 (`sdk-memory-ceiling`) on 2026-10-17, option A,
recorded in theokit-sdk as `packages/sdk/docs/adr/mutation-testing-scope.md` (bundle copy
`.squad/wiki/decisions/mutation-testing-scope.md`). The root `stryker.config.json` is the B-026
spike: it mutates `src/internal/llm/**/*.ts`, must run from `packages/sdk`, and writes
`../../reports/mutation/slice.json`. D4 runs it from the repository root and looks for
`reports/mutation/mutation.json`, so it never measures anything there. Extending Stryker is B-445
(`sdk-stryker-beyond-llm-spike`).

That ADR sits in theokit-sdk's bundle. This item's project root is theokit, so the gate reads
theokit's bundle, and the earlier record does not reach it.

One difference from B-380: four of the five theokit-sdk source files this item changed (`openai.ts`,
`openrouter-system.ts`, `anthropic-shared.ts`, `anthropic.ts`) are inside the spike's glob, and
`loop-llm-stream.ts` is not. The glob is not the limit here. D4 cannot run the spike from where it
looks, so those files carry no mutation measurement either.

## Decision

Proceed to `/review` with `auditor_unavailable_d4` dismissed for this item's theokit-sdk audit. The
score cap still applies: FAIL_SOFT reaches at most SHIPPABLE_WITH_CAVEATS.

This dismisses the cap and does not claim the code is well tested by mutation. The evidence for it
is the unit tests T1.1 to T1.3 wrote first (RED recorded in theokit-sdk), the theokit-sdk suite
passing in validation, and the live two-turn run that read 12261 cached tokens on turn 2.

## Who is affected

Only this item's review. The cap is about repository tooling, not the change: no code, dependency or
published file differs because of this record.

## What would break, and what would not

Nothing breaks. What is missing is a mutation score for the item's theokit-sdk files, which no
theokit-sdk item has had so far.

## Alternatives considered

- Run the spike by hand from `packages/sdk` over this item's files and attach the score. Rejected
  for this item: the files also carry later commits from other items, so a score over them is not a
  measurement of this change alone, and `inPlace: true` strips the exec bit from `bin/*.mjs`, a write
  into theokit-sdk this item does not own.
- Fix D4 or the Stryker config inside this item. Rejected: it widens an executing item, and it is
  B-445's scope.
- Hold the item at REVIEW for a person. Rejected: the same cause was already decided for B-380, and
  `rules/autonomy-envelope.md` says a case like one already decided is decided the same way.
