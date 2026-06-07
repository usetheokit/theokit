# Cycle Rule Schema

Canonical schema for every `rules/cycle-*.md` file. Defines required vs optional sections, the canonical vocabulary for verdicts and completion promises, and the rationale for why each cycle has a vocabulary of its own.

## Purpose

Without a shared schema, cycle rules drift: one rule calls section X "Trigger conditions", another calls it "Pre-conditions", a third "When to use". Verdict tokens proliferate (`SHIPPABLE` vs `PASS` vs `READY_TO_MERGE`) without anyone explaining why. The schema makes the contract explicit so reviewers can detect divergence and `scripts/check_xrefs.py` can enforce it mechanically.

## Required sections

Every `cycle-*.md` MUST have these top-level sections, in this order:

| # | Section | Purpose |
|---|---|---|
| 1 | `# Cycle: <NAME>` | Title + one-line tagline below it |
| 2 | `## Purpose` | What problem this cycle solves; what it produces |
| 3 | `## Pre-conditions` | When to invoke; when NOT to invoke (negative cases included) |
| 4 | `## Chain` | The ordered phases as a fenced code block — skills/scripts invoked in sequence |
| 5 | `## Anti-patterns` | Concrete failure modes a reviewer should flag |
| 6 | `## Cross-references` | Skills, sibling cycles, conventions, allowlists — every related file |

## Optional sections

A cycle MAY include any of the following, when it adds clarity:

| Section | When to include |
|---|---|
| `## Phase contracts` | Multi-phase cycles where each phase has its own input/output/hard-gate |
| `## Wiring triad` | Cycles producing code that touches production (currently: implement) |
| `## Hard gates` | When at least one finding is severe enough to block the chain |
| `## Severity rubric` | Cycles that classify findings (code-quality, review) |
| `## Verdicts` | Cycles that emit a tripartite verdict, listed with definition + downstream action |
| `## Stop conditions` | Loop-style cycles (halt-loop, ralph-loop) where a stop signal must be defined |
| `## Rollback` | Cycles whose output mutates the registered ecosystem (e.g., discover → registered skill) |
| `## Output` | When the artifacts produced live in non-obvious paths |
| `## Confidence gates between phases` | Orchestrators (auto-plan) that gate transitions |

Sections SHOULD appear in the order listed above when present. Reordering is a smell unless the cycle has a structural reason for it.

## Canonical verdict vocabularies

Each cycle has its own verdict vocabulary because the **shape of the decision** differs. The schema documents them centrally so a reader does not have to spelunk to learn what `READY_TO_MERGE` means vs `SHIPPABLE`.

| Cycle | OK | OK with caveats | Not OK — recoverable | Not OK — structural |
|---|---|---|---|---|
| `cycle-roadmap` (macro super-loop) | `MILESTONE_RELEASED` / `ROADMAP_COMPLETE` | `MILESTONE_IN_FLIGHT` (paused at release human-approval gate) | `MILESTONE_BLOCKED` (recoverable per milestone) | `ROADMAP_BLOCKED` (dependency wall across all eligible milestones) |
| `cycle-discover` | `SHIPPABLE` | `SHIPPABLE_WITH_CAVEATS` | `NEEDS_REVISION` | `INVALID` |
| `cycle-plan` | `SHIPPABLE` | `SHIPPABLE_WITH_CAVEATS` | `NEEDS_REVISION` | `INVALID` |
| `cycle-implement` | `IMPLEMENTATION_COMPLETE` (completion promise) | — | (halt-loop pauses for human) | — |
| `cycle-code-quality` | `PASS` | `PASS_WITH_CAVEATS` | — | `FAIL` |
| `cycle-review` | `READY_TO_MERGE` | — | `NEEDS_FIXES` | `NEEDS_DEEPER` |
| `cycle-release` | `RELEASED` | — | `PR_OPEN_AWAITING_APPROVAL` (paused at human-approval gate) | `BLOCKED` |
| `cycle-auto-plan` | (delegates to each chained cycle's verdict) | — | (pause + ask human at any gate failure) | — |
| `cycle-judge-codex` (optional, external plugin) | `SHIPPABLE` / `READY_TO_MERGE` (`:final` only) | `SHIPPABLE_WITH_CAVEATS` | `NEEDS_REVISION` / `NEEDS_FIXES` / `NEEDS_DEEPER` (`:final` only) | `FAIL_HARD` / `INVALID` / `META_DEFECT_FOUND` (`:final` only) / `AGGREGATOR_BUG_SUSPECTED` (`:final` only) |
| `dogfood` (utility) | `EVIDENCE_SUFFICIENT` | `EVIDENCE_WITH_CAVEATS` | — | `EVIDENCE_INSUFFICIENT` |

### Why each vocabulary differs

- **roadmap** emits **macro-loop progression verdicts** at two granularities: per-milestone (`MILESTONE_RELEASED`, `MILESTONE_IN_FLIGHT`, `MILESTONE_BLOCKED`) and at the roadmap-as-a-whole level (`ROADMAP_COMPLETE` when every milestone is `[x]`, `ROADMAP_BLOCKED` when no milestone is eligible because every unchecked one is blocked by another unchecked one — a structural dependency wall). Unlike sub-cycles, `cycle-roadmap` has no "with caveats" band because the macro-loop's only OK states are atomic: a milestone either shipped (`[x]`) or it did not.
- **discover/plan** emit a **structural fitness verdict** on a document. `INVALID` means the document violates a hard cap (fabricated citation, missing Coverage Matrix); `NEEDS_REVISION` means the score is recoverable via `*-improve`.
- **implement** does not emit a verdict — it emits a **completion promise** (`IMPLEMENTATION_COMPLETE`) consumed by downstream cycles. Halt-loop pauses on hard-gate failure rather than emitting a verdict.
- **code-quality** emits a **PASS/FAIL** because it is a binary quality gate: either every finding fits inside the severity ceiling or it does not.
- **review** emits **merge-readiness**: `READY_TO_MERGE` is the only green; `NEEDS_FIXES` returns to `/implement`; `NEEDS_DEEPER` returns to `/to-plan` for re-scoping.
- **dogfood** emits **evidence-readiness** because its decision is "is the v1.0 claim supported by recorded usage?"
- **judge-codex** mirrors the **upstream cycle's vocabulary** intentionally — `:discover`/`:plan` reuse the SHIPPABLE band; `:implementation` mirrors `cycle-implement` exit states adapted to a verdict; `:final` mirrors `cycle-review`'s merge-readiness plus two **meta-verdicts** (`META_DEFECT_FOUND`, `AGGREGATOR_BUG_SUSPECTED`) that exist only at the review-of-review stage. The plugin is **delivered externally** (`usetheodev/judge-codex-plugin-cc`) and consumes `plan`'s golden-rule files by path convention.

Do NOT introduce a new verdict token without adding it to this matrix and explaining why an existing token does not fit.

## Section conventions

- Use sentence-case headers (`## Pre-conditions`, not `## PRE-CONDITIONS`).
- The `## Chain` block MUST be a fenced code block. Phases inside use `↓` arrows for flow.
- `## Cross-references` MUST link to real files. `scripts/check_xrefs.py` validates that every backtick-referenced path resolves.
- Verdict tokens MUST be in the matrix above.
- Hard gates MUST cite the rule they enforce (e.g., "Unbreakable Rule 4" for the no-`main`-commit gate).

## Enforcement

- `scripts/check_xrefs.py` validates the `## Cross-references` section against the filesystem on every run.
- `scripts/test_e2e_smoke.py` validates that every cycle has the required sections (`## Purpose`, `## Chain`, `## Anti-patterns`).
- A new cycle without entries in the verdict matrix above is a review BLOCKER.

## Adding a new cycle

1. Copy this schema's required sections into the new rule.
2. Add the new cycle's verdict vocabulary row to the matrix above.
3. Wire the cycle in `README.md` (Project structure + the cycle diagram) and `HOW-TO-USE.md` (Which cycle, when).
4. Add the new SKILL.md `Cycle contract` section pointing back at the rule.
5. Run `python3 scripts/check_xrefs.py` and `python3 scripts/test_e2e_smoke.py` — both MUST be PASS before the cycle is merged.
