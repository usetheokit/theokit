# Cycle: ACCEPTANCE (end-user validation of the released delivery)

Source of Truth for the phase that runs **after** `cycle-release` and answers the only question the rest of the pipeline never asks: does the thing that shipped actually work for the person it was built for?

## Purpose

Every gate before this one grades the delivery against *the project's own artifacts*: tests pass, coverage holds, the reviewer approved, the tag cut. All of them can be green while the released product is broken for its user — a mis-wired env var in the deployed build, a proxy that buffers the stream, a login that 500s only against the real identity provider. None of those are visible to a test suite running on a build agent.

This cycle exercises the **released** delivery the way a user meets it, and turns the result into the gate on the milestone's `[x]`.

That placement is the whole design. Before this cycle existed, `cycle-release` flipped the ROADMAP checkbox itself, at tag-cut — so `[x]` meant *"we shipped it"*. It now means *"we shipped it and watched it work."* The flip moved here (`cycle-release § 7.5` → this cycle's `flip` phase) precisely so the claim and the evidence cannot drift apart.

The cycle produces an **acceptance record** per milestone, and a **verdict** that `cycle-roadmap` consumes.

## Pre-conditions

- `cycle-release` emitted `RELEASED` for the milestone — tag cut, GitHub release published.
- The released delivery is reachable: a deployed URL, an installed binary, a published package, or a running service.
- The milestone declares `**Definition of done (all must hold):**` bullets in `ROADMAP.md`. These are the acceptance criteria — this cycle does not invent its own.
- The milestone's checkbox is still `[ ]`.

Do NOT trigger when:

- `cycle-release` returned `PR_OPEN_AWAITING_APPROVAL` or `BLOCKED` — there is nothing released to validate.
- The milestone's checkbox is already `[x]` — either a previous acceptance run flipped it, or someone flipped it by hand (an anti-pattern; investigate before re-running).
- The delivery cannot be reached. Emit `NOT_VALIDATED` and say so; do not substitute a local build for the released artifact, which is the one class of failure this cycle exists to catch.

## Chain

```
/acceptance M<N>
     ↓ read ROADMAP.md § M<N>; confirm checkbox is [ ] and cycle-release emitted RELEASED
     ↓ extract_acceptance_criteria.py --milestone M<N>   → criteria.json (from the milestone DoD)
     ↓ resolve the target and its instrument (see § Target kinds)
     ↓
     ↓ FOR EACH criterion:
     ↓   exercise it against the RELEASED delivery, as an end user would
     ↓   capture evidence: screenshot / console / network / stdout / response body
     ↓   record status ∈ passed | failed | blocked | not_exercised
     ↓
     ↓ record every defect observed on the way, with severity + filed issue
     ↓ write knowledge-base/acceptance/{milestone}-{date}.md + evidence/
     ↓ compute_acceptance_verdict.py --criteria criteria.json --evidence evidence.json
     ↓
     ↓ ACCEPTED | ACCEPTED_WITH_CAVEATS → flip_milestone_checkbox.py  [ ] → [x]
     ↓ REJECTED                         → checkbox stays [ ]; open hotfix; back to cycle-plan
     ↓ NOT_VALIDATED                    → checkbox stays [ ]; state what could not be exercised
```

## Target kinds

The instrument changes with the delivery; the rigor does not. Exercising a *proxy* for the release (a local build, a mocked backend, a staging clone) is not this cycle — it is the thing this cycle exists to replace.

| Delivery | Instrument | What "as an end user" means |
|---|---|---|
| Web UI | `chrome-devtools` MCP | Navigate the real deployed URL, click through the journey, read console + network for errors the UI swallows |
| Native desktop app | `cua-driver` skill | Drive the installed build through its accessibility tree |
| CLI | `Bash` | Install the published artifact and run the documented commands from a clean directory |
| Library / SDK | `Bash` | Consume the published package in a throwaway project, following the README verbatim |
| HTTP API / service | `Bash` | Call the deployed endpoints with real payloads, including the documented error cases |

When a criterion cannot be exercised with any available instrument, its status is `not_exercised` — never `passed`.

## Phase contracts

| Phase | Input | Output | Hard gate |
|---|---|---|---|
| extract | `ROADMAP.md` § M\<N\> | `criteria.json` with ≥ 1 criterion | milestone declares a non-empty `**Definition of done:**`; otherwise `NOT_VALIDATED` |
| resolve-target | release artifact | target kind + reachable address | the address points at the RELEASED artifact, not a local or staging build |
| exercise | criteria + target | one result per criterion, each with evidence | every criterion has a recorded status; `passed` requires at least one evidence artifact |
| record | results + defects | `knowledge-base/acceptance/{milestone}-{date}.md` + `evidence/` | evidence files exist at the cited paths |
| verdict | `criteria.json` + `evidence.json` | verdict token | computed by `compute_acceptance_verdict.py`; never asserted by the agent |
| flip | verdict ∈ {`ACCEPTED`, `ACCEPTED_WITH_CAVEATS`} | `ROADMAP.md` `[ ]` → `[x]` + roadmap-runs updated | single-flip invariant (`cycle-roadmap § Hard gates`); no flip on `REJECTED` or `NOT_VALIDATED` |

## Verdicts

- `ACCEPTED` — every criterion was exercised against the released delivery and evidenced; no defects. Checkbox flips.
- `ACCEPTED_WITH_CAVEATS` — every criterion passed with evidence, but non-blocking defects were observed. Each defect is filed as an issue before the flip. Checkbox flips.
- `REJECTED` — at least one criterion failed in the live system, or a blocker-severity defect was observed. Checkbox stays `[ ]`. The delivery is already public: open the hotfix path immediately, then re-enter at `cycle-plan`.
- `NOT_VALIDATED` — the run could not establish either outcome: a criterion was never exercised, the target was unreachable, evidence was missing, or the milestone declared no Definition of done. Checkbox stays `[ ]`.

`NOT_VALIDATED` is deliberately distinct from `REJECTED`. "We could not check" and "we checked and it is broken" are different facts, and a cycle that collapses them starts reporting untested work as tested.

## Hard gates

- **A `passed` without evidence is not a pass.** `compute_acceptance_verdict.py` refuses it as `NOT_VALIDATED`. This is the gate the whole cycle rests on: with the human sign-off deliberately out of scope, recorded evidence is the only thing standing between a real validation and a confident sentence.
- **The verdict is computed, never asserted.** The agent that ran the journeys does not get to name the outcome — it records results, and the script derives the verdict. Reporting a verdict the script did not emit is a review BLOCKER.
- **No flip without a green verdict.** `[x]` claims a user-visible promise was met; only `ACCEPTED` / `ACCEPTED_WITH_CAVEATS` may flip it. Enforced by the single-flip invariant it inherits from `cycle-roadmap § Hard gates`.
- **The target is the released artifact.** Validating a local build, a staging clone, or a mock reproduces exactly the blind spot this cycle exists to remove.
- **Criteria come from the milestone.** They are read from `ROADMAP.md` before the run. A criterion invented or edited after seeing the result is grading a moved target — and per Unbreakable Rule 4's spirit on evidence, is fabrication.
- **Every caveat is filed.** `ACCEPTED_WITH_CAVEATS` without an issue per defect turns a known problem into an unowned one.
- **This cycle is the terminator of a `/cycle-goal` session.** A milestone goal set by `/cycle-goal` is met if and only if this cycle emitted `ACCEPTED` or `ACCEPTED_WITH_CAVEATS` for it. That makes the verdict here the single thing standing between an open goal and a closed one — which is why it is computed from evidence and never named by the agent that ran the journeys.

## Anti-patterns

- **Validating the build instead of the release.** Running the local test suite again is not acceptance; it is the check that already passed three phases ago.
- **Marking a criterion `passed` because the code looks right.** Reading the implementation is not exercising it. If the journey was not driven, the status is `not_exercised`.
- **Downgrading a failure to a caveat to let the checkbox flip.** If a Definition-of-done bullet does not hold, the milestone is not done — a caveat is for defects *outside* the declared criteria.
- **Re-running until it passes without recording the earlier failures.** Flakiness in the live system is itself a finding; silently retrying hides it.
- **Treating `NOT_VALIDATED` as a soft pass.** It blocks the flip exactly as `REJECTED` does. The milestone stays open.
- **Flipping the checkbox by hand after a `REJECTED`.** This bypasses the audit trail and re-creates the drift the cycle was built to close.

## Output

- `knowledge-base/acceptance/{milestone-id}-{YYYY-MM-DD}.md` — the acceptance record: target, criteria, per-criterion result, evidence paths, defects, computed verdict.
- `knowledge-base/acceptance/evidence/` — screenshots, console dumps, network logs, command transcripts cited by the record.
- `knowledge-base/roadmap-runs/{milestone-id}-{date}.md` — updated with the acceptance verdict when the flip happens.

The record is the artifact an auditor reads to answer "was M3 ever actually used before we called it done?" — the same question `dogfood` asks about production claims, one milestone at a time.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Skill implementing this cycle: `skills/acceptance/SKILL.md`
- Upstream cycle (must have emitted `RELEASED`): `rules/cycle-release.md`
- Macro loop that consumes this verdict: `rules/cycle-roadmap.md`
- Checkbox-flip script reused from the release slice: `skills/release/scripts/flip_milestone_checkbox.py`
- Session-binding skill whose goal terminates on this cycle's verdict: `skills/cycle-goal/SKILL.md`
- Sibling honesty gate over sustained use (consumes acceptance evidence): `rules/dogfood-golden-rule.md`
- Re-entry point on `REJECTED`: `rules/cycle-plan.md`
- Conventions: `rules/testing.md`, `rules/error-handling.md`, `rules/git-safety.md`
