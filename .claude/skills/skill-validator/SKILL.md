---
name: skill-validator
description: Validates a candidate skill in .claude/skills/generated/ produced by /skill-writer. Checks frontmatter conformance, citation existence, duplication against existing skills, description trigger-phrase clarity, and forbidden-pattern presence. Emits verdict PASS / NEEDS_REVIEW / REJECT. Invoke manually after /skill-writer produces a candidate.
user-invocable: true
allowed-tools: Read Glob Grep Bash
argument-hint: "{candidate-skill-name}"
---

# Skill-Validator — Candidate Skill Quality Gate

Validates a candidate skill produced by `/skill-writer` before it can be promoted to a first-class skill by `/skill-register`. Deterministic. Zero LLM calls. Cost $0.

## Cycle contract

This skill is **phase 7** (skill-distillation tail) of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the source of truth for the full chain (this skill validates candidates produced by `/skill-writer`; `/skill-register` consumes the PASS verdict), hard gates, soft gates, stop conditions, anti-patterns, and rollback.

**Read `cycle-discover.md` before invoking this skill.** This SKILL.md retains phase-specific detail (the 5-check validation rubric, verdict bands, output schema).

## When to Trigger

User invokes `/skill-validator {candidate-name}` explicitly after `/skill-writer` produces a candidate at `.claude/skills/generated/{name}/`, OR to re-run after manually editing a NEEDS_REVIEW candidate. The skill-distillation tail is not auto-orchestrated today — see `cycle-discover.md` for the recommended chain order.

## Validation rubric (5 checks)

Each check produces PASS / WARN / FAIL. The overall verdict is the worst result among all checks.

| Check | What it asserts | Failure level |
|---|---|---|
| **Frontmatter conformance** | Required fields present (`name`, `description`, `user-invocable`, `allowed-tools`, `generated-from-blueprint`, `generated-at`); allowed-tools is read-only (no Bash, no Write outside specific permits) | FAIL → REJECT |
| **Citation existence** | Every `.claude/knowledge-base/references/{path}` in SKILL.md exists on disk (Path.exists()) | FAIL → REJECT |
| **No duplication** | `name` field does NOT collide with an existing skill in `.claude/skills/` (production) — case-insensitive | FAIL → REJECT |
| **Description trigger-phrase clarity** | `description` contains at least 2 specific "Use when..." phrases AND ≥1 reference to a concrete context (a path, a domain term, a project rule) | WARN → NEEDS_REVIEW |
| **No forbidden patterns** | No `Bash(` permissions, no `Write` outside `Read` family, no shell-execution patterns, no fabricated source paths in `generated-from-blueprint` | FAIL → REJECT |

## Verdict bands

| Verdict | Trigger | Action |
|---|---|---|
| **PASS** | All 5 checks PASS | `/skill-register` can promote automatically |
| **NEEDS_REVIEW** | At least one WARN; zero FAILs | Skill stays in `generated/`; human reviews + manually invokes `/skill-validator` again after edits |
| **REJECT** | At least one FAIL | Skill stays in `generated/`. `/skill-register` MUST refuse. User must either fix or delete. |

## Workflow

### Step 1 — Resolve candidate skill

Resolve to `.claude/skills/generated/{candidate-name}/SKILL.md`. Verify exists.

### Step 2 — Read .source-blueprint marker

Read `.claude/skills/generated/{candidate-name}/.source-blueprint`. Extract:
- blueprint slug
- verdict at generation time
- score at generation time

If marker is missing OR verdict at generation was below SHIPPABLE_WITH_CAVEATS, emit WARN and continue.

### Step 3 — Run 5 checkers

```bash
python3 .claude/skills/skill-validator/scripts/validate_skill.py \
  .claude/skills/generated/{candidate-name}/SKILL.md
```

The script outputs JSON with per-check results + overall verdict.

### Step 4 — Render the report

Display PASS / NEEDS_REVIEW / REJECT prominently with per-check breakdown. If NEEDS_REVIEW or REJECT, list the specific issues and suggested fixes.

### Step 5 — Recommend next step

```
PASS    → "Next: /skill-register {candidate-name}"
NEEDS_REVIEW → "Manual review required. Edit SKILL.md to address WARNs, then re-run /skill-validator"
REJECT  → "Cannot promote. Either: (a) delete candidate, OR (b) fix FAILs and re-run /skill-validator"
```

## Hard rules

1. **The validator MAY NOT modify the candidate SKILL.md.** Only checks. Fixes are human (or via re-run of `/skill-writer` with updated blueprint).
2. **The validator MAY NOT skip checks.** All 5 always run. No `--skip-check` flag exists or will exist.
3. **REJECT is terminal for that candidate.** `/skill-register` refuses to act on REJECT verdict. The user must explicitly delete + re-run pipeline.

## Anti-patterns

1. **Promoting NEEDS_REVIEW without manual approval** — `/skill-register` will refuse. NEEDS_REVIEW requires a HUMAN edit + re-validation that returns PASS.
2. **Adding a 6th check ad hoc** — the rubric is locked. New checks require explicit version bump (validator-rubric-v2).
3. **Treating WARN as FAIL** — WARN means "needs human eye"; FAIL means "structurally broken". Conflating them blocks legitimate skills.

## What this skill does NOT do

- Generate skills — that's `/skill-writer`.
- Promote to first-class — that's `/skill-register`.
- Fix issues — human or re-run of upstream.
- Run skills, just validates SKILL.md as a document.

## Related

- Upstream: `/skill-writer` (produces candidate)
- Downstream: `/skill-register` (consumes PASS verdict)
- Checker: `scripts/validate_skill.py`
- Sibling: `/discover-confidence` (same architecture: deterministic Python rubric scorer)
