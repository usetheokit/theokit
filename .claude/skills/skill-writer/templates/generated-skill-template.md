---
name: {TOPIC_SLUG}-patterns
description: {DESCRIPTION}
user-invocable: true
allowed-tools: Read Glob Grep
generated-from-blueprint: {SOURCE_BLUEPRINT_SLUG}
generated-at: {YYYY-MM-DD}
---

# {TOPIC_TITLE} — Patterns Library

Knowledge distilled from `/discover-execute {SOURCE_BLUEPRINT_SLUG}`. Consult this skill when planning code that matches the trigger phrases in the `description` frontmatter above.

**Source blueprint:** `{SOURCE_BLUEPRINT_PATH}`

## When /to-plan should consult this skill

{APPLIES_WHEN}

The Step 0 frontmatter scan of `/to-plan` matches against the `description` field. The phrases above are the canonical triggers.

## Patterns

Each pattern below was extracted from an ADR in the source blueprint. The Rationale, Alternatives, and Consequences are preserved — `/to-plan` uses them to inform implementation decisions WITHOUT re-deriving the same conclusions from scratch.

{PATTERNS}

## Recommendations consolidated

Direct recommendations extracted from the source blueprint's `## Recommendations` section. Each links to the research question(s) that originated it and the project rule(s) it respects.

{RECOMMENDATIONS}

## Quick reference

Cross-cutting comparison condensed from the blueprint's `## Cross-cutting Comparison` table. Useful as a glance reference when `/to-plan` is weighing trade-offs.

{QUICK_REF_TABLE}

## Key evidence

These citations to `.claude/knowledge-base/references/` appeared in 2+ different sections of the source blueprint — they are load-bearing for the patterns above. Re-verify them when revisiting this skill (paths may drift if `.claude/knowledge-base/references/` clones are refreshed).

{KEY_CITATIONS}

## How `/to-plan` consumes this

When a topic-slug or plan context matches one of the trigger phrases in `description`, `/to-plan` Step 0 reads this SKILL.md in addition to `.claude/rules/`. The plan it produces SHOULD:

- Cite the Patterns above when the implementation decision matches one
- Reference the Recommendations as ADR alternatives in the plan's own ADR section
- Use the Key evidence citations as anchor evidence

The `/to-plan` quality rules forbid the plan from CONTRADICTING a Pattern here without an explicit ADR. To override a Pattern, the plan must include an ADR that names this skill + this pattern + the reason for divergence.

## Audit

- Generated from blueprint at `{SOURCE_BLUEPRINT_PATH}`
- Blueprint verdict at generation time: `{BLUEPRINT_VERDICT}` (score `{BLUEPRINT_SCORE}`)
- Generation timestamp: `{YYYY-MM-DD}`
- Marker file `.source-blueprint` in this skill dir preserves the audit chain

To rollback: `mv .claude/skills/{TOPIC_SLUG}-patterns/ .claude/skills/generated/{TOPIC_SLUG}-patterns/` and delete the corresponding audit entry in `.claude/knowledge-base/reviews/skill-register-*.md`.
