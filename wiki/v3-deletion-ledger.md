# v3 deletion ledger — what the framework absorbed, measured

**Milestone:** M86 · **Measured:** 2026-08-14 · **Status:** open — migration awaits a release

This is the artifact M86 exists to produce: one line per primitive, with LOC removed in the consumer
and the milestone that delivered it. It is the only evidence that v3 was worth doing.

The roadmap is explicit about the method, and it matters here: *"o ledger mede **deleção real no
commit de migração**, não o número do relatório de 2026-08-12; o relatório é a hipótese, o ledger é o
resultado."* Everything below is measured against the TheoCode tree as it stands today.

---

## The blocking fact, stated first

**The primitives of M77–M85 are not published.** They are merged to `develop` in this repo;
`@theokit/agents` on npm is `7.6.0`, which predates all of them, and TheoCode depends on `^7.5.0`.

So the deletions this ledger anticipates **cannot be executed yet**. The sequence is:

1. `develop → main` + version bump + `npm publish` (the RELEASE step of the cycle)
2. TheoCode bumps its dependency
3. One PR per primitive, each citing the milestone and the version it landed in — the in-file
   convention the repo already practises
4. This ledger closes with the deletion SHAs

Recording the blocker rather than an estimate is the point. A ledger of deletions that have not
happened is a forecast wearing an artifact's name.

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

**3. The honest conclusion is not yet available.** Whether v3 met its thesis cannot be settled until
the migration runs, because the number that counts is deletion in the migration commit. What can be
said today: the M77–M85 slice puts ~1 100 LOC in reach, and reaching 4 500 across M67–M85 depends on
what the earlier milestones removed — which this ledger will only know when each PR lands.

---

## The other DoD criteria, measured

| Criterion | Target | Measured today |
|---|---|---|
| `grep "from '@theokit/sdk"` in TheoCode `packages/*/src` | **0** | **6** |
| `@theokit/sdk` out of `packages/agent/package.json` | absent | still `^4.49.0` |

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
