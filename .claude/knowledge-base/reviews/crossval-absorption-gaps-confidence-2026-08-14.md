# Plan Confidence — crossval-absorption-gaps

**Date:** 2026-08-14
**Plan:** `.claude/knowledge-base/plans/crossval-absorption-gaps-plan.md` v1.1
**Verdict:** `SHIPPABLE`
**Score:** 100.0 (completeness 100.0 · structural risk 100.0)
**Hard caps triggered:** none

## How the plan got here

The first structural run returned `INVALID`. Every cap was real; none was waived. What changed
between that run and this one is recorded below, because a score that moved without a reason
recorded is the failure this whole ecosystem is built to prevent.

| Run | Verdict | Cap(s) | What was actually wrong |
|---|---|---|---|
| 1 | `INVALID` | `fabricated_citation`, `vague_acceptance_criteria`, `soft_floor_unresolved_questions_section_missing`, `soft_floor_concurrency_tests_missing` | Four distinct defects — see below |
| 2 | `NON_SHIPPABLE` | `vague_acceptance_criteria` | 36 of 71 criteria had no oracle |
| 3 | **`SHIPPABLE`** | none | — |

### The four defects, and which were mine

1. **`concurrency_tests` — all 17 tasks failed.** `_strip_code()` blanks fenced blocks *before*
   checking, and the canonical plan template shows the `(none — single-threaded)` escape **inside a
   fence**. Writing the plan faithfully to the template guaranteed the cap. Fixed by unfencing all 17
   subsections. **Template↔gate disagreement, not an author error.**
2. **`fabricated_citation` — 6 unresolved.** Two causes: `wiki/capability-index.md` was cited as a
   bare filename, which the checker reads as a *project rule* — but it is a file T0.3 creates, so
   citing it that way was genuinely misleading. And the edge-case report was cited bare rather than
   by path. Fixed by citing both as paths. **Half author error, half checker-convention.**
3. **`unresolved_questions` — reported empty with 5 questions present.** The counter matches
   `- Q\d`; the plan used `- **Q1 — …**`. Reformatted. **Cosmetic, but the gate was right to be
   literal.**
4. **`vague_acceptance_criteria` — 36 of 71 weak.** All 36 failed the *oracle* axis: they stated a
   condition without naming how to verify it. **A real defect.** Each now carries the command that
   proves it (`pnpm vitest run … -t <case>`, `wc -l`, `node scripts/check-surface-parity.mjs`).
   `acceptable_ratio` moved 0.493 → 1.000.
5. **`spec_smells` — 18 vague pronouns, 15 weak imperatives, 1 subjective adjective.** Sentences
   opening with "This"/"That" force the reader to infer the subject; `should`/`may`/`might` leave
   obligation ambiguous. Both matter most to the junior implementer the template is written for.
   Every one was rewritten to name its subject and state its modality. `risco_estrutural` 17 → 100.

## Dimension detail

- **Completeness 100.0** — Coverage Matrix 100% (12/12 gaps), ADR alternatives 8/8,
  TDD-in-bugfix 0/0 (no bug-fix task lacks a cycle).
- **Structural risk 100.0** — zero smell hits after the rewrite.
- **Evidence** — 47 citations resolved, 0 unresolved.
- **Baseline Context** — complete (file table with LoC + sha, callers, glossary, boundaries).
- **Patterns consumption** — clean; no `*-patterns` skill matches this plan's title/Goal (the only
  one installed targets NestJS decorators).
- **Failure scenarios** — the check reports "no external-I/O signals detected". The plan carries the
  section anyway, with 8 rows covering the filesystem stores and the OAuth refresh path. Declared
  here because a passing check for the wrong reason is worth stating.

## Honest limits

- **Calibration is `PROVISIONAL_v1`** — the scorer reports `holdout_count: 0` against a target of 30
  and `kappa_measured: false`. A score of 100 from an uncalibrated rubric means "no detector fired",
  not "this plan is certainly good".
- **`--no-code-quality`** was passed. The runtime `/code-quality` integration did not run in this
  scoring pass; it runs for real inside `/implement`'s validation gate.
- **The gates are structural.** Nothing here judges whether the 12 gaps are the *right* 12, or
  whether D1's generalized parity gate is the correct architectural call. That judgement lives in
  `/review` and, ultimately, in whether the implementation closes the gaps a consumer actually hits.

## Process findings worth carrying upstream

Two independent template↔gate disagreements surfaced in one plan, and both will hit **every** plan
this ecosystem produces:

1. The `/to-plan` template has **no `## Dependencies` section**, which `deps-audit-golden-rule.md`
   § 3 makes a hard cap.
2. The template renders the concurrency escape **inside a code fence**, which
   `check_concurrency_tests.py` strips before matching.

Both are one-line fixes to `skills/to-plan/templates/plan-template.md`. Recorded rather than
patched per-plan.

## Verdict

`SHIPPABLE` — proceed to `/implement`.
