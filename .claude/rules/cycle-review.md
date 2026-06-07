# Cycle: REVIEW

Source of Truth for the pre-merge review cycle.

## Purpose

Re-validate quality gates with stricter thresholds before merge. Catches issues that slipped past `/implement`.

## Pre-conditions

- Implementation output exists at `knowledge-base/implementations/{slug}-implementation.md`.
- Code-quality audit exists at `knowledge-base/audits/{slug}-code-quality-*.md` with verdict ∈ {`PASS`, `PASS_WITH_CAVEATS`} (per `rules/cycle-code-quality.md`).
- Working branch has commits ahead of the base branch.
- No uncommitted changes (review reads a stable state).

## Chain

```
/review {slug}
     ↓ detect domain (web/CLI/infra/data) from changed files
     ↓ spawn 5-7 specialist agents in parallel
     ↓ consolidate findings by severity (BLOCKER / HIGH / MEDIUM / LOW / INFO)
     ↓ verdict
```

## Specialist agents (typical set)

| Agent | Focus |
|---|---|
| architecture-reviewer | DIP, layering, SRP at module level |
| test-auditor | Test pyramid balance, missing edge cases, flakiness signals |
| wiring-validator | Wiring triad present for every new feature |
| cross-validation | Plan claims ↔ implementation ↔ tests consistency |
| domain-specific (1-3) | Per-domain checks (e.g., SQL injection for web, IAM misconfig for infra) |

## Verdicts

- `READY_TO_MERGE` — no BLOCKER, ≤ 2 HIGH findings with documented mitigation.
- `NEEDS_FIXES` — BLOCKER or > 2 HIGH findings. Return to `/implement` (or open targeted fix tasks).
- `NEEDS_DEEPER` — review surfaced systemic issues that exceed targeted fixes. Return to `/to-plan` for a re-scoping pass.

## Hard gates (BLOCKER-level)

- Failing tests on the working branch.
- New secrets committed (any pattern matching `.env`, `credentials*`, `*.pem`, `*.key`).
- Direct commit to `main` (Unbreakable Rule 4).
- Co-Authored-By trailer in any commit on this branch (user policy).
- `CHANGELOG.md` not updated despite production source changes (Unbreakable Rule 6).

## Output

- `knowledge-base/reviews/{slug}-review-{YYYY-MM-DD}.md` — consolidated findings with severity matrix.
- `agents/review-{slug}-{YYYY-MM-DD}/` — per-agent audit trail.

## Anti-patterns

- Treating LOW/INFO findings as blockers. They are advisory by design.
- Re-running `/review` after every fix instead of fixing the batch and re-running once.
- Reviewing your own plan in isolation. Spawn independent agents — the goal is fresh eyes.
- Skipping `/review` for "small" PRs. The gate exists for everything that touches production.

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Skill: `skills/review/SKILL.md`
- Public-copy lint: `rules/public-copy.md`
- Macro super-loop: `rules/cycle-roadmap.md` — `READY_TO_MERGE` here unblocks the release that flips the milestone checkbox
- Upstream: `rules/cycle-code-quality.md` (consumes the audit verdict)
- Conventions: `rules/architecture.md`, `rules/testing.md`
