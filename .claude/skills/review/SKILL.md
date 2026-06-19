---
name: review
version: 0.1.0
requires: [code-quality]
description: Most rigorous gate of the ecosystem. Validates quality gates + line-by-line plan vs implementation + 100% integration + integration test depth + edge-case coverage. Before starting, generates specialized review agents for the plan's domain (architecture, tests, wiring, cross-validation, domain-specific) and spawns them in parallel. Single entry-point for cycle-review. Use after /implement passed on `develop` and recent commits are ready to be audited (typically before a release cut).
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit Agent Skill
argument-hint: "{plan-slug}"
---

# Review — The Most Rigorous Gate

Single entry-point for [`cycle-review`](../../rules/cycle-review.md). The most rigorous gate of the ecosystem. Before merge, this skill:

1. **Generates specialized review agents** tailored to the plan's domain
2. **Spawns them in parallel** to review architecture, tests, wiring, cross-validation, and domain-specific concerns
3. **Validates quality gates** (test/typecheck/lint/coverage) deterministically
4. **Cross-validates line-by-line** plan vs implementation via dedicated Agent task (semantic match, not regex)
5. **Analyzes edge-case coverage** of integration tests against scenarios declared in the plan
6. **Consolidates findings** into a severity-classified report (BLOCKER/HIGH/MEDIUM/LOW/INFO — aligned with `rules/cycle-review.md`)
7. **HALTS on any BLOCKER** — merge cannot proceed until resolved

## Cycle contract

This skill is **the only phase** of [`cycle-review`](../../rules/cycle-review.md). The cycle rule is the **source of truth** for: pre-conditions, hard gates (BLOCKER never merges; NEEDS_DEEPER returns to /to-plan for re-scoping), soft gates, stop conditions, anti-patterns (never approve unresolved BLOCKER, never fabricate findings, never auto-merge), rollback (review-report only — never code).

**Read `cycle-review.md` before invoking this skill.** This SKILL.md retains phase-specific detail (domain detection, agent generation, consolidation rubric).

## When to Trigger

User explicitly invokes `/review {plan-slug}` when:

- Recent commits on `develop` passed `/implement` validation. PASS is the canonical state; PARTIAL with documented SKIPs (e.g., pre-code phase skipping npm gates) is acceptable only when `cycle-review.md § Trigger conditions` explicitly permits it for the current project lifecycle stage
- All tests are green on the branch
- The implementation plan at `plans/{slug}-plan.md` is the canonical contract (un-revised since /implement)
- PR is drafted OR ready to be drafted

Refuse to start when:

- `develop` has uncommitted changes
- `/implement` validation FAILed and was not addressed
- `/code-quality` audit is missing OR its verdict is `FAIL_SOFT` / `FAIL_HARD` / `INVALID` (per `rules/cycle-code-quality.md`)
- Tests are red
- Plan has been revised post-implementation (the plan must be the ground truth for review)

## The 5 specialized agents (generated dynamically)

Before review begins, `scripts/spawn_reviewers.py` generates N agent definition files at `.claude/agents/review-{slug}-{date}/`. These are PERSISTENT (audit trail in git) and each contains a focused system prompt. The script reads templates `agent-{role}-reviewer.md` and writes them as `{role}.md` (without the `agent-` prefix or `-reviewer` suffix) into the run directory:

| Role key | Output filename | Always generated? | What it reviews |
|---|---|---|---|
| **architecture** | `architecture.md` | Yes (baseline) | SOLID compliance per task, DIP boundary violations, design pattern misuse, hierarchical coupling |
| **tests** | `tests.md` | Yes (baseline) | Integration test depth, AAA/Given-When-Then format, fixture quality, missing scenarios from plan's TDD section |
| **wiring** | `wiring.md` | Yes (baseline) | Triad re-validation (caller + integration test + runtime metric) in DEPTH; integration of new code with existing flows; dead exports |
| **cross-validation** | `cross-validation.md` | Yes (baseline) | Line-by-line plan vs commits: every plan task → which commits implement it → was Acceptance Criteria met → was DoD satisfied |
| **domain-{X}** | `domain-{X}.md` | 1-3 dynamic | Domain-specific: memory layer patterns (Project A-shape pipeline integrity), pgvector schema compliance, auth flows, frontend a11y, etc. — depends on `detect_domain.py` output |

Total: 4 baseline + 1-3 domain-specific = 5-7 agents per `/review` invocation.

## Workflow

### Step 1 — Pre-condition validation (refuse if any fails)

```bash
# Plan exists and was not revised post-implementation
test -f .claude/knowledge-base/plans/{slug}-plan.md
# Branch state clean (no uncommitted changes)
[ -z "$(git status --porcelain)" ]
# On develop (NEVER on main — main is release-only)
[ "$(git branch --show-current)" = "develop" ]
# /implement validation passed (or PARTIAL with acceptable SKIPs)
test -f .claude/knowledge-base/reviews/{slug}-implement-validate-*.md
# /code-quality audit exists AND verdict ∈ {PASS, PASS_WITH_CAVEATS}
# (FAIL_SOFT / FAIL_HARD / INVALID block /review per cycle-code-quality.md)
test -f .claude/knowledge-base/audits/{slug}-code-quality-*.md
grep -qE '"verdict":[[:space:]]*"(PASS|PASS_WITH_CAVEATS)"' .claude/knowledge-base/audits/{slug}-code-quality-*.md \
  || (echo "Refuse: /code-quality verdict is not PASS/PASS_WITH_CAVEATS. Loop back to /implement." && exit 1)
# Tests green on the branch
npm test  # or skip if pre-code phase
```

If any check fails, refuse with the specific missing piece surfaced honestly. The `/code-quality` gate is mandatory — `/review` refuses to start when the audit is missing or its verdict is below `PASS_WITH_CAVEATS`.

### Step 2 — Domain detection

```bash
python3 .claude/skills/review/scripts/detect_domain.py \
  --plan .claude/knowledge-base/plans/{slug}-plan.md \
  --diff-base main
```

Output: JSON with detected domains + confidence per domain.

```json
{
  "primary_domain": "memory-layer",
  "secondary_domains": ["pgvector-schema", "llm-extraction"],
  "confidence": {"memory-layer": 0.92, "pgvector-schema": 0.78, "llm-extraction": 0.65},
  "domain_keywords_matched": ["memory store", "embedding", "Postgres", "pgvector", "remember"]
}
```

### Step 3 — Spawn specialized agents (parallel)

```bash
python3 .claude/skills/review/scripts/spawn_reviewers.py \
  --plan .claude/knowledge-base/plans/{slug}-plan.md \
  --slug {slug} \
  --primary-domain memory-layer \
  --secondary-domains pgvector-schema,llm-extraction \
  --output-dir .claude/agents/review-{slug}-{YYYY-MM-DD}/
```

Both `--slug` and `--primary-domain` are required. `--date` defaults to today UTC; `--diff-base` defaults to `main`.

The script:
1. Reads templates at `templates/agent-*.md`
2. Substitutes `{SLUG}`, `{DATE}`, `{PLAN_PATH}`, `{DIFF_BASE}`, `{DOMAIN}`, `{SECONDARY_DOMAINS}`
3. Writes 5-7 agent definition files (each is a valid Claude Code agent with frontmatter + system prompt)

After files are written, **invoke each agent in parallel via the Agent tool**. The output directory contains one `.md` file per role: `architecture.md`, `tests.md`, `wiring.md`, `cross-validation.md`, plus 1-3 `domain-{X}.md`. For each file:

```
Read the agent file content. Invoke:
Agent(
  subagent_type="general-purpose",
  description=f"Review-{role}",
  prompt=<full agent .md content as system prompt + "Run your review now. Output structured findings.">
)
```

Each agent runs its review independently and returns findings in a structured format (see "Findings format" below). Skill collects all findings.

### Step 4 — Consolidate findings

```bash
python3 .claude/skills/review/scripts/consolidate_findings.py \
  --findings-dir .claude/agents/review-{slug}-{date}/findings/ \
  --output .claude/knowledge-base/reviews/{slug}-review-{date}.md
```

The script:
1. Reads each agent's findings (saved during Step 3)
2. Deduplicates findings that multiple agents flagged
3. Classifies severity: BLOCKER / HIGH / MEDIUM / LOW / INFO (per `rules/cycle-review.md`)
4. Cross-references with plan's Acceptance Criteria and Global DoD
5. Emits consolidated report

### Step 5 — Re-validate quality gates

Run validation gates from `/implement`'s validation report, but with TIGHTER thresholds:

```bash
python3 .claude/skills/implement/scripts/run_validation.py {slug}  # already exists
```

Plus, `/review` adds:
- Coverage on critical paths MUST be 100% (not just 90% like /implement's permissive default)
- Lint warnings: 0 (not "fewer than before")
- Test runtime regression check (if previous run available)

### Step 6 — Edge-case coverage analysis

```bash
python3 .claude/skills/review/scripts/edge_case_coverage.py \
  --plan .claude/knowledge-base/plans/{slug}-plan.md \
  --tests-dir tests/
```

The script:
1. Extracts every Edge Case mentioned in the plan (Deep Dives + Acceptance Criteria sections)
2. Searches tests/ for assertions exercising each edge case (keyword match + AST pattern via ast-grep)
3. Reports: covered / partial / missing edge cases

### Step 7 — HALT-if-BLOCKER decision

After all findings consolidate, decide (per `rules/cycle-review.md § Verdicts`):

- Any BLOCKER → **HALT**. Merge cannot proceed. Loop back to `/implement` to fix.
- More than 2 HIGH → **HALT** unless every HIGH is explicitly dismissed with ADR-style rationale in the report; up to 2 HIGH with documented mitigation MAY emit READY_TO_MERGE.
- Any MEDIUM → surface to human; accept WITH_CAVEATS in PR description OR fix.
- LOW/INFO → log; merge can proceed.

### Step 8 — Final report

Write consolidated review report at:

```
.claude/knowledge-base/reviews/{slug}-review-{date}.md
```

Report format (see `consolidate_findings.py`):

```markdown
# Review: {slug}

**Date:** {date}
**Reviewers (spawned agents):** 5-7 (list)
**Findings:** N total (BLOCKER: N, HIGH: N, MEDIUM: N, LOW: N, INFO: N)
**Verdict:** READY_TO_MERGE / NEEDS_FIXES / NEEDS_DEEPER

## BLOCKER findings (must fix before merge)
### F1: {description}
- Severity: BLOCKER
- Found by: {agent role}
- File: src/path/to/file.ts:42
- Plan reference: T1.2 Acceptance Criteria item 3
- Recommended action: {specific}

## HIGH findings
...

## MEDIUM findings
...

## Edge-case coverage report
- Covered: N/M
- Missing: [{edge case 1}, {edge case 2}]

## Cross-validation summary
- Plan tasks: N
- Fully implemented: N
- Partially: N
- Missing: N
- Diverged: N

## Quality gates summary
- npm test: PASS
- npm run typecheck: PASS
- npm run lint: PASS (0 warnings)
- Coverage on critical paths: 100% / 92%
- Wiring triad: 12/12 symbols pillar (a) PASS; 11/12 pillar (b); 8/12 pillar (c) observed

## Spawned agents (audit trail)
- .claude/agents/review-{slug}-{date}/architecture.md
- .claude/agents/review-{slug}-{date}/tests.md
- .claude/agents/review-{slug}-{date}/wiring.md
- .claude/agents/review-{slug}-{date}/cross-validation.md
- .claude/agents/review-{slug}-{date}/domain-memory-layer.md
- .claude/agents/review-{slug}-{date}/domain-pgvector-schema.md

## Handoff decision
{READY_TO_MERGE: open PR / NEEDS_FIXES: loop /implement / NEEDS_DEEPER: re-spawn with broader scope}
```

## Findings format (each agent emits)

Every spawned agent MUST return findings in this format:

```yaml
agent: architecture
review_target: commits on `develop` for plan {slug}
findings:
  - id: F-arch-1
    severity: HIGH  # BLOCKER / HIGH / MEDIUM / LOW / INFO
    file: src/core/memory-store.ts
    line: 42
    plan_ref: T1.2 Acceptance Criteria item 3
    summary: src/core/ imports from src/local/ — violates DIP per architecture.md
    evidence: |
      ```ts
      import { PgvectorStore } from '../local/pgvector-store';
      ```
    recommended_action: Move PgvectorStore import to a factory module; inject via DIP boundary.
  - id: F-arch-2
    severity: INFO
    ...
```

## Inviolable rules

- The skill NEVER modifies code on `develop` — only writes review reports
- The skill NEVER approves a PR with unresolved BLOCKER findings — even on human override, requires explicit ADR-style dismissal IN THE REPORT
- The skill NEVER fabricates findings — if a file has no issues, the finding is "INFO: no issues found"
- The skill SHOULD cover every file in the diff (each baseline agent is briefed to enumerate touched files via the diff base). When a file is genuinely trivial — pure rename, single-line typo — the finding is "INFO: no issues found". Coverage is enforced by agent prompts today; a future `consolidate_findings.py` check may mechanically assert "every changed file appears in ≥1 finding"
- The skill NEVER reviews without the plan as ground truth — review without plan is vibes
- The skill NEVER auto-merges — final merge is always human decision
- The skill NEVER reviews code modified between `/implement` validation and `/review` — if commits happened, re-run `/implement` validation
- The skill NEVER deletes the spawned agent files post-review — they are audit trail (per user decision: persist as audit)

## When to give up honestly

Per `cycle-review.md § Stop conditions`:

1. Review depth requires domain knowledge outside training (cryptography, hardware-specific, regulatory compliance) → mark BLOCKED with reason "requires human domain expert"
2. PR scope ambiguous (changes touch files unrelated to plan) → halt; surface to human
3. Agent task returns inconsistent findings 2× → escalate; consolidation cannot proceed reliably

## Related

- Cycle rule (SoT): [`cycle-review.md`](../../rules/cycle-review.md)
- Upstream cycle: [`cycle-implement.md`](../../rules/cycle-implement.md)
- Agent templates: `templates/agent-*.md`
- Orchestrator prompt: `prompts/orchestrator-prompt.md`
- Scripts: `scripts/detect_domain.py`, `scripts/spawn_reviewers.py`, `scripts/edge_case_coverage.py`, `scripts/consolidate_findings.py`
- Reuses: `.claude/skills/implement/scripts/run_validation.py` (quality gates), `.claude/skills/implement/scripts/check_wiring.py` (wiring re-validation)
- Generated audit trail: `.claude/agents/review-{slug}-{date}/`
- Final reports: `.claude/knowledge-base/reviews/{slug}-review-{date}.md`
- Project rules consumed: `architecture.md`, `testing.md`, `public-copy.md`, `discover-blueprint-golden-rule.md` (if review touches docs/blueprints)

## Match to the work

This skill spawns 5-7 agents in parallel — the gate is "MAIS RIGOROSO de TODAS". Don't run `/review` for trivial changes; for small PRs, the built-in `/review` (Anthropic) is sufficient and far lighter.
