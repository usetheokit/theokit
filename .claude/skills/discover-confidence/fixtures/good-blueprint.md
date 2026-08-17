# Blueprint: Reference Implementations Survey — `<topic>`

> **Version 1.0** — A consolidated technical blueprint capturing how `<project-a>`, `<project-b>`, and `<project-c>` implement `<topic>`. Output of `/discover-execute reference-<topic>-survey`.

**Slug:** `reference-<topic>-survey`
**Source plan:** `knowledge-base/discoveries/plans/reference-<topic>-survey-plan.md`
**Owner:** team
**Generated:** YYYY-MM-DD via `/discover-execute`
**Confidence verdict:** PROVISIONAL (awaiting `/discover-confidence`)

## Context

The project enters a space where three open-source players already implement `<topic>` at different abstraction levels. This blueprint surveys their integration-test patterns, dependencies, tooling, and core techniques to feed concrete architectural decisions for our own implementation. The investigation targets the three repos cloned under `knowledge-base/references/` (`knowledge-base/references/project-a/README.md`, `knowledge-base/references/project-b/README.md`, `knowledge-base/references/project-c/README.md`).

## Objective

Produce a side-by-side reference that lets the team decide which integration-test pattern, dependency profile, and dev-tooling story to adopt for v0.1 of the contract — informed by what already works in production-shaped projects.

## Coverage Corner 1 — Integration Tests

### Project A

Project A ships a multi-package monorepo. The primary package metadata sits at `knowledge-base/references/project-a/package.json` and the contributor guide describes the integration setup at `knowledge-base/references/project-a/CONTRIBUTING.md`. The migration guide at `knowledge-base/references/project-a/MIGRATION_GUIDE_v1.0.md` documents how integration coverage evolved between v0 and v1.0.

### Project B

Project B lives as a single Python package. Its integration coverage is anchored at `knowledge-base/references/project-b/test_regression_case.py` (a regression case for a specific concurrency hang) and the contributor guidance at `knowledge-base/references/project-b/CONTRIBUTING.md` is mandatory reading before any blueprint-level decision. Package surface is declared in `knowledge-base/references/project-b/pyproject.toml`.

### Project C

Project C uses pytest with property-based testing. Its test fixtures live under `knowledge-base/references/project-c/tests/conftest.py` and at least one docstring-as-test pattern is captured at `knowledge-base/references/project-c/tests/test_docstring_examples.py`. The project's test entrypoint contract is defined at `knowledge-base/references/project-c/pytest.ini`.

## Coverage Corner 2 — Dependencies

### Project A

Project A's runtime dependencies live in `knowledge-base/references/project-a/package.json`. The integration with a host runtime is the canonical example of how Project A wires in — captured in the surface documentation at `knowledge-base/references/project-a/README.md`.

### Project B

Project B's runtime dependencies are pinned in `knowledge-base/references/project-b/pyproject.toml`. The lockfile-equivalent and JSON-side metadata appear at `knowledge-base/references/project-b/project.json` and `knowledge-base/references/project-b/package-lock.json` (for the auxiliary Node tooling).

### Project C

Project C uses `uv` as the lockfile manager. Runtime dependencies are pinned at `knowledge-base/references/project-c/pyproject.toml` and the resolved set is locked at `knowledge-base/references/project-c/uv.lock`. Framework integration metadata is at `knowledge-base/references/project-c/framework.json`.

## Coverage Corner 3 — Tools

### Project A

Local-dev story documented at `knowledge-base/references/project-a/README.md`. Contributor tooling at `knowledge-base/references/project-a/CONTRIBUTING.md`. Agent-mode operating notes at `knowledge-base/references/project-a/AGENTS.md` and `knowledge-base/references/project-a/LLM.md`.

### Project B

Project B dev-loop instructions at `knowledge-base/references/project-b/README.md`. Security policy at `knowledge-base/references/project-b/SECURITY.md` documents the supported attack surface. License terms at `knowledge-base/references/project-b/TERMS.md` (relevant when choosing what to borrow into a community-auxiliary MIT codebase).

### Project C

Project C uses a `Makefile` for the tool entry points — `knowledge-base/references/project-c/Makefile` lists every dev command. README onboarding at `knowledge-base/references/project-c/README.md`.

## Coverage Corner 4 — Techniques

### Core algorithm

The three projects diverge on how the core algorithm is implemented:

- Project A uses a multi-phase pipeline (documented at high level in `knowledge-base/references/project-a/README.md`).
- Project B operates on a state-machine model (documented in `knowledge-base/references/project-b/README.md`).
- Project C treats the same problem as graph nodes (documented in `knowledge-base/references/project-c/README.md`).

### Test discipline

Each project anchors its test discipline differently. Project A's CONTRIBUTING (`knowledge-base/references/project-a/CONTRIBUTING.md`) emphasises end-to-end smoke. Project B's CONTRIBUTING (`knowledge-base/references/project-b/CONTRIBUTING.md`) emphasises regression catches like the case at `knowledge-base/references/project-b/test_regression_case.py`. Project C (`knowledge-base/references/project-c/tests/test_docstring_examples.py`) leans on docstring-as-test which doubles as documentation.

## Cross-cutting Comparison

| Dimension | Project A | Project B | Project C |
|---|---|---|---|
| Test pyramid anchor | smoke + e2e via `knowledge-base/references/project-a/CONTRIBUTING.md` | regression-first per `knowledge-base/references/project-b/test_regression_case.py` | property + docstring per `knowledge-base/references/project-c/tests/conftest.py` |
| Primary deps file | `knowledge-base/references/project-a/package.json` | `knowledge-base/references/project-b/pyproject.toml` | `knowledge-base/references/project-c/pyproject.toml` + `knowledge-base/references/project-c/uv.lock` |
| Dev tooling entrypoint | npm scripts in `knowledge-base/references/project-a/package.json` | none unified (manual venv) | `knowledge-base/references/project-c/Makefile` |
| Signature pattern | multi-phase pipeline | state machine | graph-based |

## ADRs

### D1 — Adopt Project A's multi-phase pipeline shape

**Decision:** Our v0.1 adopts Project A's multi-phase pipeline as documented in the exploration report at `knowledge-base/references/project-a/README.md` and the lock summary in our `CLAUDE.md`.

**Rationale:** Project A has the closest shape to our contract. Project B's state-machine model and Project C's graph model would force a re-architecture. Going with Project-A-shape (not Project-A-clone) lets us absorb their pipeline without inheriting their dependency footprint.

**Alternatives considered:** (a) Project B's state-machine — rejected, too far from our contract; (b) Project C's graph model — deferred to v0.4.

**Consequences:** v0.1 implementation can lean on documented patterns; we must port the algorithm into our own abstractions.

### D2 — Pin pyproject.toml shape for our Python tool surface

**Decision:** The Python tools under `skills/` track a single `pyproject.toml` per skill, mirroring Project B's `knowledge-base/references/project-b/pyproject.toml` simplicity rather than uv-lock complexity from `knowledge-base/references/project-c/uv.lock`.

**Rationale:** Our Python surface is small. uv.lock is overkill; `pyproject.toml` alone is sufficient.

**Alternatives considered:** (a) full uv.lock per skill — rejected as YAGNI; (b) no pyproject.toml, pip install on-the-fly — rejected, blocks `setup.sh` from doing version checks.

**Consequences:** Skill maintainers pin minimal deps in `pyproject.toml`; CI installs via `pip install -e`.

## Recommendations

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| 1 | Implement the multi-phase pipeline in `src/core/<topic>/` | Q1, D1, architecture.md § DIP boundaries | HIGH |
| 2 | Adopt regression-first test discipline borrowed from Project B's pattern | Q5, testing.md § Pyramid | HIGH |
| 3 | Defer graph-based variant to v0.4 | D1 (alternatives), CLAUDE.md § Roadmap | MEDIUM |
| 4 | Skip uv.lock complexity; stay on plain pyproject.toml for skill Python surface | D2 | LOW |

## Blocked questions

None — every question in the source plan was answerable from the cloned repos.

## Halt-loop progress (audit trail)

- Iterations used: 6 / 30
- Questions answered: 8 / 8
- Questions blocked: 0
- Citations verified: 21 / 21
- Promise emitted at iteration: 6

## Related

- Discovery plan: `knowledge-base/discoveries/plans/reference-<topic>-survey-plan.md`
- Confidence report: `knowledge-base/reviews/reference-<topic>-survey-confidence-YYYY-MM-DD.md`
- Linked rules: `rules/architecture.md`, `rules/testing.md`, `rules/public-copy.md`
