---
type: defaults-bundle
created_at: 2026-05-21
purpose: Fallback research-coverage definition when project has no `.claude/rules/discover-blueprint-*` files
---

# Default Research Coverage (FALLBACK ONLY)

**This document is FALLBACK.** If `.claude/rules/discover-blueprint-golden-rule.md` exists, it is the source of truth and these defaults are IGNORED.

The skill `/discover-confidence` checks `.claude/rules/` FIRST. Only when the relevant rule files are missing does it fall back to:

- `research-coverage.md` (this file) — the 4-corner coverage definition
- `../templates/rubric-blueprint.md` — the rubric (always used; not overridable by project)
- `../templates/discover-blueprint-thresholds.example.txt` (used when `.claude/rules/discover-blueprint-thresholds.txt` is missing)

## Four-corner Coverage

Every blueprint produced by `/discover-execute` MUST populate all four corners:

| # | Corner | Required H2 section in blueprint | Empty triggers |
|---|---|---|---|
| 1 | Integration tests | `## Coverage Corner 1 — Integration Tests` | `empty_corner_tests` hard cap (≤49) |
| 2 | Dependencies | `## Coverage Corner 2 — Dependencies` | `empty_corner_deps` hard cap (≤49) |
| 3 | Tools | `## Coverage Corner 3 — Tools` | `empty_corner_tools` hard cap (≤49) |
| 4 | Techniques | `## Coverage Corner 4 — Techniques` | `empty_corner_techniques` hard cap (≤49) |

A corner is "populated" when:

- The H2 section exists in the blueprint.
- At least one subsection (H3) under it has non-placeholder content (not `<!-- TBD -->`, not empty, not only headings).

## Mandatory subsections per corner

Each corner SHOULD have one subsection per in-scope reference project (declared in the source discovery plan). If the discovery plan declared 3 projects (Project A, Project B, Project C), each corner SHOULD have 3 subsections.

If a project's subsection is intentionally empty (e.g., the discovery plan deferred Q5 for Project B), an explicit `<!-- DEFERRED: see ADR Dx -->` comment MUST be present. The completeness checker recognizes this as not-empty.

## Mandatory cross-cutting sections

Beyond the 4 corners, every blueprint MUST contain:

- `## Cross-cutting Comparison` — consolidated side-by-side table
- `## ADRs` — at least one ADR with alternatives
- `## Recommendations for OurProject` (or whatever the consuming project is) — at least one concrete recommendation

These are checked by `check_blueprint_completeness.py` and trigger a soft cap (≤70) when missing.

## Citation density

The blueprint SHOULD have at least 1 `.claude/knowledge-base/references/{project}/{path}` citation per 200 words of prose. Lower density triggers `soft_floor_citation_density_low` (cap at 89, not INVALID).

## Per-project asymmetry

Content across in-scope projects must be roughly proportional to the time budget declared in the plan's ADR D1. If one project ends up with > 80% of blueprint content while others have < 5%, the soft cap `soft_floor_per_project_asymmetry` fires (cap at 89).

**Status:** documented as policy but NOT yet enforced — no Python checker exists in `discover-confidence/scripts/` for this cap as of M2. Deferred to M2.1. Until then this cap never fires automatically; manual review of cross-project balance is still recommended during human inspection.
