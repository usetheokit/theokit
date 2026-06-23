---
slug: v2-4-di-gateways-dual-surface
milestone_id: V2-4
created_at: 2026-06-23
goal: Register theokit ADR 0032 — the final verdict on di/gateways/orm + the dual HTTP surface, grounded in V2-2/V2-3 adoption evidence — verified by the ADR containing Decision + rejected Alternatives + cited evidence and resolving the dual-surface tension.
---

# V2-4 — Strategic ADR: di/gateways future + dual HTTP surface resolution

## Goal
Register **theokit ADR 0032** giving the FINAL verdict on the broader declarative layer (`theokit-di`/`di-agent`/`orm`/gateways) and the dual HTTP surface, grounded in the adoption evidence V2-2/V2-3 produced — verified by `grep` that the ADR contains a Decision, ≥1 rejected Alternative, cited adoption evidence (theocode + theokit-di/gateways consumers), and an explicit dual-surface resolution.

## Context
V2-4 is the final V2 milestone (the gap-audit's M8-4 / Tema F / Seção 6 strategic question). The predecessor **theokit ADR 0031** (2026-06-22) wired the 3 mapped agents decorators and declared di/gateways/orm "optional, imperative-first, opt-in", but flagged M8-4 as the OPEN strategic question and had NO adoption evidence (it predates V2-2/V2-3). The evidence sweep (captured in `knowledge-base/discoveries/blueprints/v2-4-di-gateways-dual-surface-blueprint.md`) now answers it: the V2 reference app (theocode SDK 2.5) adopted ZERO of di/di-agent/orm/gateways/decorators; the dual HTTP surface tension was resolved by M7 (theokit 0.8.1 — convention server gained typed health/errors). This ADR records the verdict.

## Baseline Context

### Files that will be touched
| File | LoC today | Last touch | Why it exists |
|---|---|---|---|
| `.claude/knowledge-base/adrs/0032-v2-4-di-gateways-dual-surface-verdict.md` | 0 (NEW) | — | the strategic verdict ADR (the deliverable) |
| `CHANGELOG.md` | ongoing | ongoing | `[Unreleased]` entry (Rule 6 — a registered ADR is a documented decision) |

### Current callers / dependents
- `.claude/knowledge-base/adrs/0031-m8-decorator-runtime-and-di-strategy.md` — the direct predecessor (decision point 3 deferred the broader-di verdict to M8-4); ADR 0032 continues it.
- `.claude/knowledge-base/adrs/0030-library-subpackages-never-depend-on-principal-theokit.md` — the dependency-direction invariant the verdict respects.
- `theokit-sdk` ADR `revoke-decorators-mandatory` — the Harness-side revocation the verdict references (cross-repo).
- The dual-surface symbols the ADR cites as RESOLVED: `defineHealthRoute`/`defineReadyRoute` (`src/server/define/health-route.ts:49,59`), `TheoError`/`fromUnknown`/`serverErrorToEnvelope`/`NotFoundError` (`src/core/contracts/theo-error.ts`), `theokit/boot` `createConventionFetchHandler`.

### Domain glossary
- **ADR** — Architecture Decision Record; theokit's are numbered `NNNN-*.md` under `.claude/knowledge-base/adrs/`.
- **dual HTTP surface** — (a) the convention/filesystem-route dev-server (`theokit dev`, `defineRoute`, file-based routes) vs (b) the imperative `@theokit/http` `TheoApp`.
- **imperative/factory-first on-ramp** — building an agent app via factory functions (`Agent.create`/`defineTool`) rather than decorators/DI.
- **opt-in external package** — a package in a sibling repo (`theokit-di`, `theokit-gateways`) a consumer adds only if it wants it; the Harness never depends on it.

### Architecture boundaries affected
None changed — this is a DECISION record, not code. It RATIFIES the existing boundary (`revoke-decorators-mandatory`/0030/0031): the Harness + the principal `theokit` do not depend on di/gateways/orm; those stay external. The ADR cites file:line evidence but edits no source. Per `rules/` (ADR discipline) the record must carry Decision + Alternatives + Consequences.

## Prior Art & Related Work
- theokit ADR 0031 (predecessor), ADR 0030 (dependency-direction invariant); theokit-sdk `revoke-decorators-mandatory` (decorator revocation).
- The V2 evidence: theocode `.claude/knowledge-base/implementations/v2-2-def-reconciliation-findings.md` (di/orm OUT-OF-REPO, not adopted), theokit-sdk `docs/gap-audit/ROADMAP-v2.md` §V2-2/V2-3 status.
- The evidence sweep blueprint (this slug).

## ADRs (plan-authoring decisions)

### D1 — Register the verdict as theokit ADR 0032 (not a theokit-sdk D-ADR)
**Decision:** Author the verdict as `theokit/.claude/knowledge-base/adrs/0032-*.md`.
**Rationale (cites `rules/` ADR discipline + ADR 0031):** ADR 0031 ("M8 decorator runtime and DI strategy") lives in theokit and explicitly deferred the broader-di verdict to M8-4; the dual HTTP surface is a theokit (`packages/theo`) concern; theokit is the principal project where the ecosystem boundary verdict belongs. 0032 continues the 0031 sequence and references theokit-sdk `revoke-decorators-mandatory` cross-repo.
**Alternatives rejected:** (a) Register the verdict in theokit-sdk as a new D-series ADR — rejected: the dual-surface decision is theokit's, and 0031 (the thing being finalized) lives here; splitting the verdict across repos fragments the record. (b) Only update the ROADMAP, no ADR — rejected: the DoD requires a registered ADR with decision + alternatives + evidence.

### D2 — Ground every claim in cited file:line evidence; no speculation
**Decision:** Every decision point cites the adoption/dual-surface evidence (theocode deps + grep verdicts, theokit-di/gateways consumers, the M7 symbols) from the sweep.
**Rationale (cites Unbreakable Rule 3 honesty):** 0031 lacked evidence; V2-4's whole value is deciding WITH data. An ADR asserting "di is unused" without the grep evidence is a post-rationalization.
**Alternatives rejected:** (a) Assert the verdict from the V2 narrative without re-citing evidence — rejected: unverifiable; a reviewer must be able to re-run the greps. (b) Re-run a fresh full audit — rejected: the V2-2/V2-3 + the 2026-06-23 sweep already provide it (YAGNI).

## Dependency Graph
- Phase 1 (author + register ADR 0032) — no blockers.
- Phase 2 (Integration Validation) — depends on Phase 1.

## Phases

### Phase 1 — Author + register ADR 0032

#### Task T1.1 — Write the verdict ADR

##### Why this step
**Action:** Write `.claude/knowledge-base/adrs/0032-v2-4-di-gateways-dual-surface-verdict.md` with: Status/Date/Deciders/Milestone/Context; a Decision section with the 4 verdict points (di/gateways external+opt-in; imperative on-ramp complete; dual-surface resolved/convention-primary; residual follow-ups); Rationale citing the evidence; ≥3 rejected Alternatives; Consequences.
**Reasoning:** this IS the milestone deliverable — the registered strategic verdict (D1) grounded in evidence (D2), continuing ADR 0031.

##### Files to edit
- `.claude/knowledge-base/adrs/0032-v2-4-di-gateways-dual-surface-verdict.md` (NEW)

##### Deep file dependency analysis
The ADR references (does not edit): ADR 0031/0030 (this repo), theokit-sdk `revoke-decorators-mandatory`, the dual-surface symbols (`health-route.ts`, `theo-error.ts`), theocode's adoption verdicts, and theokit-di/gateways consumer counts — all from the blueprint's cited evidence. No source file changes.

##### TDD
- The acceptance criteria below ARE the executable contract (grep checks on the ADR). No code/unit test (decision artifact); the review phase validates the evidence is real (not fabricated).

##### Concurrency tests
(none — single-threaded)

##### Acceptance criteria
- `grep -c "^## Decision" .claude/knowledge-base/adrs/0032-*.md` → `1`.
- `grep -ciE "alternativ" .claude/knowledge-base/adrs/0032-*.md` ≥ `1` (rejected alternatives present).
- `grep -ciE "theocode|@theokit/di|gateway" .claude/knowledge-base/adrs/0032-*.md` ≥ `3` (adoption evidence cited).
- `grep -ciE "dual.surface|defineHealthRoute|TheoApp|convention" .claude/knowledge-base/adrs/0032-*.md` ≥ `2` (dual-surface tension explicitly resolved).

##### DoD
- The ADR has Status: Accepted + Date + Milestone: V2-4, and references ADR 0031 + theokit-sdk `revoke-decorators-mandatory`.

#### Task T1.2 — CHANGELOG entry

##### Why this step
**Action:** Add a `CHANGELOG.md [Unreleased]` entry recording ADR 0032 (the strategic verdict).
**Reasoning:** Unbreakable Rule 6 + the theokit stop-hook CHANGELOG gate — a registered decision is a documented change.

##### Files to edit
- `CHANGELOG.md`

##### Deep file dependency analysis
The CHANGELOG `[Unreleased]` section exists (verified). The entry points readers to ADR 0032. No code dependency.

##### TDD
(doc — covered by the acceptance grep)

##### Concurrency tests
(none — single-threaded)

##### Acceptance criteria
- `grep -c "0032" CHANGELOG.md` ≥ `1` (the ADR is referenced under `[Unreleased]`).

##### DoD
- CHANGELOG `[Unreleased]` references ADR 0032.

### Phase 2 — Integration Validation

#### Task T2.1 — Evidence integrity + cross-reference check

##### Why this step
**Action:** Verify every file:line the ADR cites actually resolves (the M7 symbols exist; ADR 0031/0030 exist; theocode's no-adoption holds), and that the ADR's cross-references (0031, `revoke-decorators-mandatory`) are correct.
**Reasoning:** an ADR's credibility is its evidence — the validation re-confirms the cited evidence is real (no fabricated citation), the honesty gate for a decision record.

##### Files to edit
- (none — validation phase)

##### TDD
(integration phase — re-greps the cited evidence)

##### Concurrency tests
(none — single-threaded)

##### Acceptance criteria
- Cited theokit symbols resolve: `grep -rl "defineHealthRoute" src/server/define/ ; echo $?` → 0 and `grep -rl "serverErrorToEnvelope" src/core/contracts/ ; echo $?` → 0.
- Predecessor ADRs exist: `ls .claude/knowledge-base/adrs/0031-*.md .claude/knowledge-base/adrs/0030-*.md` → both present.
- theocode no-adoption holds: `grep -rl "@theokit/di\b" /home/paulo/Projetos/usetheo/theocode/server /home/paulo/Projetos/usetheo/theocode/app 2>/dev/null | wc -l` → `0` (no real di import).

##### DoD
- All cited evidence re-verified present/absent as the ADR claims; no fabricated citation.

## Coverage Matrix
| # | Requirement (ROADMAP-v2 §V2-4 DoD) | Task(s) | Resolution |
|---|---|---|---|
| 1 | ADR registered with a Decision | T1.1 | ADR 0032 `## Decision` (4 verdict points) |
| 2 | Rejected alternatives present | T1.1 | `## Alternatives` (≥3 rejected) |
| 3 | Grounded in adoption evidence | T1.1, T2.1 | cited theocode + di/gateways consumer evidence; re-verified |
| 4 | Dual-surface tension resolved | T1.1 | convention-primary verdict + M7 symbols cited |
| 5 | Decision recorded (CHANGELOG) | T1.2 | `[Unreleased]` references ADR 0032 |
| 6 | Evidence integrity (no fabricated citation) | T2.1 | cited symbols/ADRs/no-adoption re-greped |

**Coverage: 6/6 (100%)** — V2-4 is a decision record; "resolution" of di/gateways = ratify the external+opt-in boundary (no code), of dual-surface = the convention-primary verdict citing the shipped M7 primitives.

## Drawbacks & Risks
| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The ADR asserts a verdict not backed by evidence (post-rationalization) | Medium | D2 + T2.1 re-grep every cited claim; the review phase independently re-verifies | author |
| Dual-surface "resolved" overstates (residual TODOs remain) | Medium | The ADR explicitly lists residual follow-ups (readiness wiring, theocode upgrade, NotFoundError naming) as non-blocking, not hidden | author |
| Verdict drifts from `revoke-decorators-mandatory`/0031 (contradicts prior ADRs) | Low | The ADR CONTINUES 0031 + cites `revoke-decorators-mandatory`; it ratifies, not reverses | author |

## Unresolved Questions
(none — every decision is resolved at plan time)

The residual follow-ups (theocode adopting `defineHealthRoute`, readiness-config wiring, `NotFoundError` naming) are tracked as non-blocking Consequences in the ADR, not open questions.

## Global DoD
- ADR 0032 registered (Status: Accepted, Milestone: V2-4) with Decision + ≥3 rejected Alternatives + cited evidence + dual-surface resolution + Consequences.
- CHANGELOG `[Unreleased]` references ADR 0032.
- Every cited file:line / ADR / no-adoption claim re-verified (T2.1) — no fabricated citation.
- Continues ADR 0031; references theokit-sdk `revoke-decorators-mandatory`.

## Final Phase: Integration Validation
Covered by Phase 2 / T2.1 — the cited evidence integrity check is the "eat your own cooking" gate for a decision record.

## Failure scenarios
(none — no external I/O; this milestone authors a decision record and re-greps existing evidence.)
