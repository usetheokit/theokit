# Discover-Plan — Portable Installation

This skill works in **any project** that uses Claude Code AND has a `.claude/knowledge-base/references/` (or equivalent) directory of read-only reference implementations to investigate.

## What you get

- `/discover-plan {topic-slug}` — generates a discovery plan saved at `.claude/knowledge-base/discoveries/plans/{slug}-plan.md`
- A template (`templates/discovery-plan-template.md`) that bakes in Fase A → Fase B (ast-grep then Read), Coverage Matrix, ADRs, halt-loop checkpoints

The skill itself produces NO output until invoked. It is pure instructions + template + fixtures.

## Quick install (2 steps)

### 1. Copy the skill directory

```bash
cp -r /path/to/source/.claude/skills/discover-plan .claude/skills/
```

The skill walks UP from the saved plan path to find your project root (`.claude/` or `.git/` marker).

### 2. Ensure the consumer chain exists

`/discover-plan` is only useful if at least `/discover-edge-cases` is installed alongside (next step in the chain). The full chain is:

```
/discover-plan → /discover-edge-cases → /discover-execute → /discover-confidence → (/discover-improve if needed) → /discover-confidence re-score
```

If your project has all five: full pipeline. If only `/discover-plan`: standalone planning, but `/discover-execute` references in the SKILL.md will be unactionable until the rest are installed.

## Project requirements

### Required

- **`.claude/rules/` directory** with at least `architecture.md` and `testing.md` (or your project's equivalents). Step 0 of the protocol mandates reading them. If missing, the skill falls back to a generic "no rules" plan (lower quality output).
- **A reference-clones directory** — the SKILL.md examples cite `.claude/knowledge-base/references/project-a/`, `.claude/knowledge-base/references/project-b/`, `.claude/knowledge-base/references/project-c/`. If your project uses a different path (e.g., `vendor/`, `third_party/`, `studies/`), see § Customization below.
- **`.claude/knowledge-base/discoveries/plans/` directory** — where the plan is saved. Created on first use if missing.

### Optional but recommended

- A foundation doc (e.g., a landscape survey) in `docs/` — Step 1 reads it for inventory of what is already known. If absent, skill skips that step.
- Prior exploration reports under `docs/exploration-reports/*.md` (if any) — the plan cross-references them.
- `CLAUDE.md § Architectural Decisions Locked` — root-level lock list. Without it, ADRs in the plan won't reference upstream decisions.

## What happens out of the box

When you invoke `/discover-plan {topic-slug}`:

1. Reads `.claude/rules/` to internalize project principles
2. Reads any `docs/*.md` foundation docs + `CLAUDE.md` (if present) for context inventory
3. Lists `.claude/knowledge-base/references/{project-a,project-b,project-c}/` top-level structure (or your equivalent)
4. Defines investigation targets (in-scope / out-of-scope)
5. Declares four-corner coverage (5-10 questions total, max 3 per corner)
6. Writes the plan at `.claude/knowledge-base/discoveries/plans/{slug}-plan.md`

## Customizing for your project

### 1. Different reference-clones directory

If your project uses `vendor/` instead of `.claude/knowledge-base/references/`:

```bash
# Find every .claude/knowledge-base/references/ mention in the skill and replace
sed -i 's|.claude/knowledge-base/references/|vendor/|g' .claude/skills/discover-plan/SKILL.md
sed -i 's|.claude/knowledge-base/references/|vendor/|g' .claude/skills/discover-plan/templates/discovery-plan-template.md
```

Or simpler: add a project-specific override at `.claude/rules/discover-plan-overrides.md` that the skill reads first.

### 2. Different reference projects

The SKILL.md examples cite Project A / Project B / Project C. To investigate different projects, just use them in your `{topic-slug}` and Research Questions — the skill doesn't enforce specific project names. The "1 question per corner" rule applies to whatever projects you list.

### 3. Different "four corners"

The four corners (tests / deps / tools / techniques) are tuned for software-implementation investigations. For different domains, edit the corner table in `SKILL.md § Step 3` AND in the template's Coverage Matrix.

Examples:

- **Academic-paper survey**: corners might be methodology / dataset / baselines / results
- **Library benchmark**: corners might be correctness / latency / memory / API surface
- **Architectural pattern study**: corners might be context / problem / forces / consequences

If you change corners, update BOTH the SKILL.md AND `templates/discovery-plan-template.md` § Coverage Matrix table.

### 4. Time-budget defaults

The template suggests "Project A: 4h, Project B: 2h, Project C: 1h" as illustrative. For your project, set per-discovery defaults based on your team's calibration. After 5-10 real discoveries, you'll know the realistic per-project budget.

## What's portable, what's project-specific

| Element | Portable? | Notes |
|---|---|---|
| `SKILL.md` protocol (Step 0-4) | ✅ Fully | Generic. `.claude/rules/` lookup is project-agnostic. |
| Question budget rule (5-10, max 3 per corner) | ✅ Fully | Domain-agnostic heuristic. |
| Fase A → Fase B workflow | ✅ Fully | Investigation pattern, not tool-specific. |
| Template structure (10 mandatory sections) | ✅ Fully | Coverage Matrix shape is universal. |
| Cited paths `.claude/knowledge-base/references/project-a/...` | ❌ Project-specific | Examples reference OurProject's clones. Replace with your paths. |
| Example ADRs (D1 Project A/Project B/Project C budget) | ❌ Project-specific | Adapt to your reference list. |

## Limitations (Known)

- **No self-scoring** — discovery plans don't have a confidence scorer (the closest is `/discover-confidence`, which scores BLUEPRINTS, not plans). Quality of a plan is gated only by the next skill in the chain (`/discover-edge-cases`).
- **No automated tests** — unlike `plan-confidence` (21 pytest tests), `discover-plan` is exercised only by real invocations. The fixtures at `fixtures/` are reference examples for humans, not test inputs.
- **Step 0 fallback weak** — if `.claude/rules/` is missing, the skill notes the absence but does not auto-generate a fallback rule set. The resulting plan will not pass the architecture-compliance soft cap in `/discover-confidence`.
- **Single-reference-project plans** — the template assumes ≥2 in-scope projects (Project A + Project B + Project C). For single-project investigations, the "Cross-cutting Comparison" section in the resulting blueprint will be degenerate. Either accept the trade-off or fork the template.

## Self-validation

After install, sanity-check with:

```bash
# Confirm the SKILL.md is readable and has the four-corner table
grep -E '^### Step [0-4]' .claude/skills/discover-plan/SKILL.md

# Confirm the template has the 10 mandatory sections (1 H1 + 9 H2)
grep -cE '^##? ' .claude/skills/discover-plan/templates/discovery-plan-template.md
# Should print 10 (1 H1 "Discovery Plan:" + 9 H2 sections)

# Confirm fixtures are present
ls .claude/skills/discover-plan/fixtures/
```

## Related

- Skill: `.claude/skills/discover-plan/SKILL.md`
- Template: `.claude/skills/discover-plan/templates/discovery-plan-template.md`
- Fixtures: `.claude/skills/discover-plan/fixtures/`
- Downstream: `/discover-edge-cases` (next step) → `/discover-execute` (consumes plan)
- Sibling: `/to-plan` (same architecture, different output — implementation plans)
