# v3 deletion ledger — what the framework absorbed, measured

**Milestone:** M86 · **Measured:** 2026-08-14 · **Status:** migration STARTED — two batches landed, measured below

This is the artifact M86 exists to produce: one line per primitive, with LOC removed in the consumer
and the milestone that delivered it. It is the only evidence that v3 was worth doing.

The roadmap is explicit about the method, and it matters here: *"o ledger mede **deleção real no
commit de migração**, não o número do relatório de 2026-08-12; o relatório é a hipótese, o ledger é o
resultado."* Everything below is measured against the TheoCode tree as it stands today.

---

## The blocker is cleared — what has actually been deleted

The primitives shipped as **`@theokit/agents@8.0.0`** (2026-08-14), TheoCode moved off `^7.5.0`, and
the deletions began. What follows is measured in the migration commits, not estimated.

| Batch | TheoCode commit | Deleted | Net |
|---|---|---|---:|
| Migration to 8.0.0 | `41125d1` | — (two breaking call sites adapted) | +49 |
| `shutdown` + diagnostics mechanism | `b80baa8` | `shared/src/shutdown.ts` (67) + its test (73) | −108 |
| Doctor quartet | `31fd051` | `diagnose` / `renderDiagnosis` / `Check` / `Diagnosis` | −12 |
| Ask rendezvous + 3 error classes | `34d2c97` | the whole rendezvous + `concurrent-question` / `concurrent-listener` / `question-abandoned` (61) | −4 |
| | | **measured total** | **−63 net (347 removed, 284 added)** |

Three findings from doing it, each of which the estimate could not have produced:

**1. Two files became adapters rather than disappearing, for a reason worth stating.**
`diagnostic-sink.ts` survives at 29 lines because the framework reads `THEOKIT_DIAGNOSTICS` and this
product's operators have `THEOCODE_DIAGNOSTICS` in their shells; adopting the framework's key would
be a breaking change disguised as a refactor, failing silently. `doctor.ts` survives because the
LIST of checks is the product's — only the quartet was ever shared.

**2. What came back is stronger than what left.** `Diagnosis.failed` is a count with an `exitCode`,
and `diagnose([])` no longer reports a clean bill of health — the local version returned
`failed: false` for an empty list, so a product whose check list failed to load announced that an
installation nobody examined was fine. `createShutdown` names its cleanups (the watchdog says WHICH
one hung) and distinguishes three outcomes where the local one had two. A clean Ctrl-C now exits
130, the Unix convention, instead of 0.

**3. A defect in the framework's own publish surfaced only here.** `@theokit/http@1.0.0` declared
`peerDependencies: { "@theokit/agents": ">=0.47.0" }` — the direction G1 forbids, with a range naming
another package's version line. It put a second, older copy of `@theokit/agents` in every consumer's
install tree. The source had been correct since the cycle was broken; the version was never bumped,
so the registry kept serving the old manifest. Fixed and published as `@theokit/http@1.1.0`, and the
G1 guard — which asserted the direction by reading `src` imports only — now reads the manifest too.

---

## Measured today: what M77–M85 makes deletable

| Milestone | TheoCode file | LOC |
|---|---|---:|
| M77 | `agent/src/ask/ask-bridge.ts` | 103 |
| M77 | `agent/src/ask/concurrent-question-error.ts` | 15 |
| M77 | `agent/src/ask/question-abandoned-error.ts` | 23 |
| M77 | `agent/src/ask/interactive-shell-tool.ts` | 26 |
| M77 | `tui/src/consent/pending-approvals.ts` | 87 |
| M78 | `agent/src/tools/tool-scope.ts` | 12 |
| M78 | `agent/src/config/sandbox-policy.ts` | 27 |
| M78 | `agent/src/tools/view-image.ts` | 49 |
| M79 | `agent/src/auth/credentials.ts` | 390 |
| M79 | `agent/src/auth/credential-provenance.ts` | 70 |
| M80 | `tui/src/formatting/turn-error.ts` | 37 |
| M81 | `agent/src/delegation/delegation-cap.ts` | 33 |
| M83 | `shared/src/shutdown.ts` | 67 |
| M84 | `shared/src/diagnostic-sink.ts` | 33 |
| M84 | `tui/src/formatting/last-usage.ts` | 10 |
| M84 | `agent/src/doctor.ts` | 116 |
| | **total** | **1 098** |

Not every line goes: several files reduce to an adapter rather than disappearing. The number above is
the ceiling of what M77–M85 puts in reach, not a promise of net removal.

---

## The gap, recorded rather than silenced

The DoD sets the bar at **≥ 4 500 LOC** across M67–M85 and says what to do when it is not met:
*"abaixo disso, a v3 não cumpriu a tese e o gap remanescente é registrado como escopo v4, não
silenciado."*

Measured, the M77–M85 slice reaches **1 098**. Three things are true about that number and all three
belong here:

**1. It does not include M67–M76.** Those landed in earlier cycles and TheoCode has already absorbed
several of them — which is visible in the tree: `tools/tool-scope.ts` is **12 LOC today**, where the
2026-08-12 report describes the pre-migration file. The file already became an adapter. A ledger that
counted the report's number would be claiming a deletion that happened months ago, twice.

**2. The report was the hypothesis.** Several targets are smaller than it estimated —
`view-image.ts` is 49 LOC, not the 89 the M78 objective cites. The roadmap anticipated exactly this
and said the ledger, not the report, is the result.

**3. The estimate is now measurably too high for at least one target, and the reason generalises.**
M79 was booked at 460 LOC (`auth/credentials.ts` 390 + `auth/credential-provenance.ts` 70). Measured
against the shipped framework, what actually moves is the RESOLUTION and the `SourceOrigin` type —
roughly six lines of shape. The rest of those files is OAuth storage, token refresh and `.env`
parsing, which the framework never absorbed and, per its own scope, should not.

That is the pattern behind the gap: the report counted whole FILES that touch a concern the framework
now covers, while the framework absorbed the MECHANISM inside them. Both deletions measured so far
behaved this way — 140 LOC removed against ~210 booked for M83+M84, and the remainder is adapter,
not waste.

**4. The net number is SMALLER than the lines removed, and that is the finding, not a rounding
error.** 347 lines left; 284 arrived. The arrivals are not padding — they are the adapters, and the
tests that had to be rewritten because the contract they asserted became the framework's. The ask
batch is the clearest case: the entire rendezvous was deleted and the net was **−4**, because the
address translation that replaced it (thread → question id) plus a test suite rewritten to drive the
module instead of a class cost almost exactly what the mechanism did.

A ledger that reported only "347 deleted" would be true and misleading. The honest claim is: the
DUPLICATED MECHANISM is gone — four modules of it — and what remains in its place is smaller in
concept while similar in size.

**5. The conclusion is still not available, and is now narrower.** 63 net lines against a 4 500 bar.
Whether v3 met its thesis depends on the batches not yet run — M78's tool scope, M79's credential
resolution (measured above as far smaller than booked), M80's error formatting, M81's delegation cap.
On the current evidence the 4 500 figure will not be met by a wide margin, and the reason is
structural rather than a shortfall of effort: the report counted files, the framework absorbed
mechanisms, and mechanisms are a minority of the lines in the files that hold them. That belongs in
the v4 scope conversation as a corrected premise, not as a missed target.

---

## The other DoD criteria, measured

| Criterion | Target | Measured today |
|---|---|---|
| `grep "from '@theokit/sdk"` in TheoCode `packages/*/src` | **0** | **0** ✅ |
| `@theokit/sdk` out of `packages/agent/package.json` | absent | **absent** ✅ |

Both closed on 2026-08-14. The six survivors were import-site, not missing primitives: five are the
M67 pass-through family and the sixth is `ToolResultContentBlock` — and the ledger's own note that
the sixth "needs the SDK release carrying `createViewImageTool`" was wrong when measured. All eight
symbols were already re-exported from `@theokit/agents`'s barrel; re-pointing the imports and
dropping the dependency took one commit, and the consumer's suite stayed green (529).

That is the M67 thesis holding: a consumer should not have to declare a dependency on the SDK to use
what the framework already passes through. Until this commit, it did — and the criterion had been
sitting in a Definition of done that nobody measured.

The six survivors, named so the next pass does not have to rediscover them:

```
agent/src/config/layers.ts          foldLayers, verifyLayerOrdering
agent/src/config/config.ts          auditEnvReachability
agent/src/config/trust-posture.ts   (trust posture family)
agent/src/config/security-floor.ts  applySecurityFloor
agent/src/wired-capabilities.ts     recordWiring, WiredEntity
agent/src/tools/view-image.ts       ToolResultContentBlock (type only)
```

Five of the six are the M67 pass-through family, and all five are re-exported from `@theokit/agents`
today — so they are import-site changes, not missing primitives. The sixth is a type that
`createViewImageTool` makes unnecessary once the SDK release carrying it lands (`theokit-sdk#281`).

---

## What is NOT claimed here

That the migration is done. That the 4 500 threshold is met. That every primitive fits — the DoD
requires each non-adopted one to carry a written reason, and those reasons can only be written by
trying, which requires the release.

Refusing in silence is the one outcome the milestone forbids. This file is the opposite of that: the
gap has a number, a cause, and a next step.

## Cross-references

- Milestone: `ROADMAP-v3.md § M86`
- The primitives, by milestone: `CHANGELOG.md` `[Unreleased]`
- Consumer: `usetheo-labs/TheoCode`
- SDK-side companion: `usetheodev/theokit-sdk#281` (`createViewImageTool`)
