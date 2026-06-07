---
type: plan
created_at: 2026-05-17
slug: good-plan
status: draft
---

# Plan: Good Fixture (passes all M2 checks)

> Version 1.0 — Synthetic plan used as fixture. Full coverage, ADRs with alternatives, bug-fix with TDD, zero smells. Follows `architecture.md` and `testing.md`, honoring SOLID + DRY + KISS. All files ≤ 500 LoC.

## Context

Toy plan para teste do `check_coverage_matrix.py`, `check_adr_completeness.py`, `check_tdd_in_bugfix.py`, `check_spec_smells.py`. Compliance: cita `architecture.md`, `testing.md`, SOLID, DRY.

## Baseline Context

### Files that will be touched

| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/parser.py | 120 | f7a91be (2026-05-17) | parse function for fixture domain | public function `parse()` MUST remain callable |
| tests/test_parser.py (NEW) | 0 | — | new regression test | — |

### Current callers / dependents

- **Symbol:** `parse()` in `src/parser.py`
- **Callers (production):** src/runner.py:12
- **Callers (tests):** tests/test_runner.py

### Domain glossary

- **fixture** — synthetic plan input used by the test suite
- **rubric** — scoring contract loaded by `_rubric_loader.py`

### Architecture boundaries affected

No new boundary crossings. Stays inside `src/` per `rules/architecture.md`.

## Prior Art & Related Work

- Internal pattern: existing fixtures in `skills/plan-confidence/fixtures/` set the convention.
- Internal rule: `rules/testing.md` defines the TDD discipline this plan honors.

## Objective

Done = passa todos os 4 checks estruturais + os 2 novos (Baseline Context, Drawbacks). Verdict SHIPPABLE.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Fixture drift — fixture diverges from real-plan structure as template evolves | Low | re-run smoke after each template change | author |
| False-positive in regex-based checkers if fixture phrasing collides | Low | property-based tests in `test_properties.py` | author |

## Unresolved Questions

(none — every decision is resolved at plan time)

## ADRs

### D1 — Use Python stdlib only

- **Decision:** Implementar com stdlib + PyYAML.
- **Rationale:** Alternatives considered: use `pydantic` (rejected — extra dependency); use `regex` lib (rejected — `re` from stdlib is enough). Stdlib is pure YAGNI.
- **Consequences:** Zero deps adicionais.

### D2 — Determinismo total

- **Decision:** Zero LLM calls em M2.
- **Rationale:** Alternativa rejeitada: usar LLM para summarization (fica para M3). Determinismo permite cache forte.
- **Consequences:** Tests podem ser hashable input/output.

## Dependency Graph

```
T1.1 -> T1.2 -> T2.1
```

## Phase 1: Setup

### T1.1 — Add bug-fix regression test

#### Objective
Resolve bug em parsing.

#### Files to edit
```
src/parser.py
```

#### TDD
```
RED: test_parser_handles_empty_input
GREEN: implement fix
REFACTOR: None
VERIFY: pytest
```

#### Acceptance Criteria
- [ ] Returns `200` for happy path inputs; returns `400` for malformed body
- [ ] Exit code 0 on the new unit test with at least 1 assertion verifying the return value

#### DoD
- [ ] Coverage >= 90% on changed files

### T1.2 — Add feature

#### Objective
Add new feature.

#### Files to edit
```
src/feature.py
```

#### TDD
```
RED: test_feature_works
GREEN: implement
REFACTOR: None
VERIFY: pytest
```

#### Acceptance Criteria
- [ ] Function returns `True` when input is non-empty; returns `False` for empty input
- [ ] Unit test exits 0 asserting both branches

#### DoD
- [ ] Merged with commit subject referencing the task ID

## Phase 2: Polish

### T2.1 — Documentation

#### Objective
Document.

#### Files to edit
```
README.md
```

#### Tasks
1. Update README.

#### Acceptance Criteria
- [ ] Documentation contains a Usage section with at least 1 code example
- [ ] Lint check returns 0 errors on the updated documentation

#### DoD
- [ ] PR merged with subject containing `docs(t21)`

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Parser bug | T1.1 | Regression test + fix |
| 2 | New feature | T1.2 | Implementation |
| 3 | Docs gap | T2.1 | README updated |

**Coverage: 3/3 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases done
- [ ] Tests passing
- [ ] cargo clippy passes (lint, complexity ≤ 10)
- [ ] All files ≤ 500 LoC
