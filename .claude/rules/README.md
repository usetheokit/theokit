# Rules

Source of truth for cycle contracts, golden rules, thresholds, and allowlists.
Every cycle reads its contract from here; every quality gate references a golden
rule file.

## Cycle Contracts

Each `cycle-{name}.md` defines:
- Entry conditions and prerequisites
- Phase sequence with advance criteria
- Hard gates (BLOCKER-level) and soft gates (advisory)
- Cross-references to skills, hooks, and scripts
- Verdicts vocabulary (e.g., SHIPPABLE_WITH_CAVEATS, READY_TO_MERGE)

| Contract | Cycle | Key Verdicts |
|---|---|---|
| `cycle-roadmap.md` | Macro super-loop | ROADMAP_COMPLETE |
| `cycle-discover.md` | Prior art research | SHIPPABLE_WITH_CAVEATS |
| `cycle-plan.md` | Planning | SHIPPABLE_WITH_CAVEATS |
| `cycle-implement.md` | Implementation | IMPLEMENTATION_COMPLETE |
| `cycle-code-quality.md` | Code quality audit | PASS, PASS_WITH_CAVEATS, FAIL_SOFT, FAIL_HARD, INVALID |
| `cycle-review.md` | Multi-agent review | READY_TO_MERGE, NEEDS_FIXES, NEEDS_DEEPER |
| `cycle-release.md` | Release cut | RELEASED, PR_OPEN_AWAITING_APPROVAL |
| `cycle-analysis.md` | Trajectory analysis (opt-in, post-release) | ON_TRACK, COURSE_CORRECTION_NEEDED |
| `cycle-judge-codex.md` | External Codex jury (optional plugin) | SHIPPABLE, READY_TO_MERGE |
| `cycle-auto-plan.md` | Auto-orchestrator | Delegates to sub-cycles |

## Golden Rules (locked severity rubrics)

| File | Purpose |
|---|---|
| `code-quality-golden-rule.md` | Code quality severity levels |
| `discover-blueprint-golden-rule.md` | Blueprint confidence hard caps |
| `plan-confidence-golden-rule.md` | Plan confidence scoring rubric |
| `discover-plan-golden-rule.md` | Discovery plan scoring rubric |
| `deps-audit-golden-rule.md` | Dependency audit severity |
| `dogfood-golden-rule.md` | Anchor scenario + status vocab |
| `analysis-golden-rule.md` | Trajectory analysis modules + verdict caps |

## Thresholds and Allowlists

| File | Purpose |
|---|---|
| `code-quality-thresholds.txt` | Per-project threshold overrides |
| `code-quality-allowlist.txt` | Findings exemptions (mandatory sunset) |
| `code-quality-languages.txt` | Enabled languages per project |
| `plan-confidence-thresholds.txt` | Plan scoring thresholds |
| `plan-confidence-allowlist.txt` | Plan findings exemptions |
| `discover-web-allowlist.txt` | Authoritative domains for WebFetch |
| `deps-audit-allowlist.txt` | Dependency audit exemptions |
| `discover-blueprint-thresholds.txt` | Blueprint confidence thresholds |
| `discover-plan-thresholds.txt` | Discovery plan scoring thresholds |
| `analysis-config.txt` | Trajectory analysis profile + enablement |
| `review-model-routing.txt` | Agent model routing for review |

## Other Rules

| File | Purpose |
|---|---|
| `cycle-rule-schema.md` | Canonical schema + verdict matrix for all `cycle-*.md` |
| `architecture.md` | Layering and DIP boundaries |
| `testing.md` | TDD discipline and pyramid |
| `error-handling.md` | Fail-fast discipline, typed errors (Unbreakable Rule 8) |
| `git-safety.md` | Forbidden git commands + safe substitutes (Unbreakable Rule 4) |
| `parsimony-ladder.md` | Pre-write minimalism ladder (YAGNI/KISS/Don't-Reinvent) enforced in GREEN phase |
| `public-copy.md` | Banned framings in README/marketing |
| `audit-trail-rotation.md` | When to archive/delete artifacts |
| `loop-engine-convention.md` | Skill vs Agent vs ralph-loop |

## Modifying Rules

- Cycle contracts and golden rules are **locked** — changes require team discussion
- Thresholds and allowlists are per-project and can be adjusted freely
- Run `python3 scripts/check_xrefs.py` after any change to validate references
