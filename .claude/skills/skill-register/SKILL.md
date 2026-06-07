---
name: skill-register
description: Promotes a candidate skill from .claude/skills/generated/ to .claude/skills/ (first-class). Requires a PASS verdict from /skill-validator. Writes audit trail at .claude/knowledge-base/reviews/skill-register-{name}-{date}.md before the move. Refuses to act on REJECT or NEEDS_REVIEW (without override).
user-invocable: true
allowed-tools: Read Glob Bash Write Edit
argument-hint: "{candidate-skill-name}"
---

# Skill-Register — Promotion Gate

Promotes a validated candidate skill from staging to production. After this, `/to-plan` discovers the skill via Step 0 frontmatter scan.

## Cycle contract

This skill is **phase 8** (final phase, skill-distillation tail) of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the source of truth for the full chain, hard gates (validator PASS required), preconditions, and rollback (`mv .claude/skills/{name}/ .claude/skills/generated/{name}/`).

**Read `cycle-discover.md` before invoking this skill.** This SKILL.md retains phase-specific detail (preconditions, workflow, audit trail format, rollback procedure).

## When to Trigger

User invokes `/skill-register {candidate-name}` explicitly after `/skill-validator` returned PASS for the same candidate. The skill re-runs the validator as its first action — refuses if the verdict is anything but PASS. The chain is human-orchestrated today; there is no auto-advance from `/skill-validator`.

## Hard preconditions (refusal otherwise)

1. **Validator verdict must be PASS** for the candidate. The skill re-runs `/skill-validator` as the first action; if not PASS, refuse with reason.
2. **The candidate must live at** `.claude/skills/generated/{candidate-name}/`. Refuse if elsewhere.
3. **No existing first-class skill with the same name.** The validator already checks this, but `/skill-register` re-checks immediately before the move to catch race conditions.

## Workflow

### Step 1 — Re-validate (always)

```bash
python3 .claude/skills/skill-validator/scripts/validate_skill.py \
  .claude/skills/generated/{candidate-name}/SKILL.md
```

If verdict ≠ PASS, abort with the verdict reported. Even if the user manually approved a NEEDS_REVIEW earlier, the re-run must confirm the issues are resolved.

### Step 2 — Move from staging to production

```bash
python3 .claude/skills/skill-register/scripts/register_skill.py \
  --candidate {candidate-name} \
  --target .claude/skills/
```

The script:
1. Verifies `.claude/skills/{candidate-name}/` does NOT exist
2. Moves `.claude/skills/generated/{candidate-name}/` → `.claude/skills/{candidate-name}/`
3. Preserves the `.source-blueprint` marker file (becomes audit metadata)
4. Sets file permissions appropriately

### Step 3 — No settings.json patching (intentional)

The current `register_skill.py` does NOT modify `.claude/settings.json`. This is deliberate: `/skill-validator`'s `check_no_forbidden_patterns` already rejects any candidate that declares Bash patterns beyond the safe defaults. Because the gate upstream is enforced, register has nothing left to patch.

If a future change loosens the validator's tool allowlist, this step gains an implementation. Until then, treat the absence of settings patching as a feature, not an omission.

### Step 4 — Write audit trail

Append to `.claude/knowledge-base/reviews/skill-register-{name}-{YYYY-MM-DD}.md`:

```markdown
# Skill Registration: {name}

**Date:** {YYYY-MM-DD}
**Source blueprint:** {blueprint-slug}
**Blueprint verdict:** {SHIPPABLE / SHIPPABLE_WITH_CAVEATS}
**Validator verdict:** PASS
**Registered from:** .claude/skills/generated/{name}/
**Registered to:** .claude/skills/{name}/

## Skill description (verbatim from frontmatter)
{description text}

## Patterns extracted
{N patterns from {N} ADRs}

## Next step
- /to-plan can now consume this skill via Step 0 frontmatter scan.
- To rollback: `mv .claude/skills/{name}/ .claude/skills/generated/` and delete the audit entry.
```

### Step 5 — Recommend next step

```
=== Skill-Register complete ===
Skill: .claude/skills/{name}/
Audit: .claude/knowledge-base/reviews/skill-register-{name}-{date}.md

The skill is now first-class. /to-plan will discover it on the next invocation via Step 0.

To exercise: invoke /to-plan with a topic that matches the skill's trigger phrases.
```

## Rollback

Rolling back a registered skill is intentional and supported:

```bash
mv .claude/skills/{name}/ .claude/skills/generated/{name}/
# Optionally also revert any settings.json patches; check the audit file
```

The skill returns to staging. /to-plan stops discovering it. The audit entry remains as historical record.

## Hard rules

1. **Never bypass /skill-validator.** Re-validate every time, even if validator just ran.
2. **Never move without audit.** The audit file MUST be written before the move completes.
3. **Never edit the candidate SKILL.md.** Promotion is a move + permission update, nothing else.
4. **Refuse same-name collisions.** First-class skills are namespaced by `name`. Two skills with the same name cannot coexist.

## Anti-patterns

1. **Promoting from anywhere but `generated/`** — refuse. Staging path is fixed.
2. **Granting `Bash(*)` permissions for a generated skill** — validator forbids; if validator says it's needed, the candidate is malformed.
3. **Skipping the audit trail** — audit is structural, not optional. The trail is how rollback works.

## What this skill does NOT do

- Generate skills — `/skill-writer`.
- Validate — `/skill-validator`.
- Update `/to-plan/SKILL.md` to reference the new skill — `/to-plan` discovers via Step 0 frontmatter scan; no edit needed.
- Test the registered skill — that's a separate concern (no skill-testing tool exists yet).

## Related

- Upstream: `/skill-validator` (PASS verdict required)
- Consumer: `/to-plan` (discovers registered skills via Step 0)
- Script: `scripts/register_skill.py`
- Sibling concept: `/plan-improve` (also writes audit trails via ralph-loop)
