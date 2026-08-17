---
type: plan
created_at: 2026-05-17
slug: missing-coverage-plan
status: draft
---

# Plan: Missing Coverage Fixture (triggers Coverage Matrix < 100% hard cap)

> Version 1.0 — Coverage Matrix tem 3 gaps mas only 2 mapeados. Hard cap "coverage_lt_100" deve disparar -> verdict INVALID, score ≤ 49.

## Context

Toy.

## Objective

Trigger coverage hard cap.

## ADRs

### D1 — Single decision

- **Decision:** Toy.
- **Rationale:** Alternativa rejeitada: doing nothing.
- **Consequences:** Nothing.

## Dependency Graph

```
T1.1 -> T1.2
```

## Phase 1

### T1.1 — Task one

#### Objective
Toy.

#### Files to edit
```
a.py
```

#### TDD
```
RED: test_one
GREEN: do
```

#### Acceptance Criteria
- [ ] OK

#### DoD
- [ ] OK

### T1.2 — Task two

#### Objective
Toy.

#### Files to edit
```
b.py
```

#### TDD
```
RED: test_two
GREEN: do
```

#### Acceptance Criteria
- [ ] OK

#### DoD
- [ ] OK

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | First gap | T1.1 | resolved |
| 2 | Second gap | T1.2 | resolved |
| 3 | Third gap |  | NOT MAPPED |

**Coverage: 2/3 gaps covered (67%)**

## Global DoD

- [ ] Done
