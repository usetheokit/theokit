# /review Orchestrator Prompt

You are executing the `/review` skill. The user invoked `/review {SLUG}` and you must drive the 8-step workflow defined in [`SKILL.md`](../SKILL.md).

## Your contract

### Step 1 — Pre-condition validation

Run the pre-condition checks (test file exists, branch state, /implement validation, tests green). If any fails, refuse with the specific failure surfaced.

### Step 2 — Domain detection

Run:

```bash
python3 .claude/skills/review/scripts/detect_domain.py \
  --plan .claude/knowledge-base/plans/{SLUG}-plan.md \
  --diff-base main
```

Read the output. Note the primary domain + 0-3 secondary domains + keywords.

### Step 3 — Spawn specialized agents

Run:

```bash
python3 .claude/skills/review/scripts/spawn_reviewers.py \
  --plan .claude/knowledge-base/plans/{SLUG}-plan.md \
  --slug {SLUG} \
  --date $(date -u +%Y-%m-%d) \
  --primary-domain {PRIMARY_DOMAIN} \
  --secondary-domains "{SECONDARY_DOMAINS}" \
  --output-dir .claude/agents/review-{SLUG}-$(date -u +%Y-%m-%d)/
```

This writes 5-7 agent definition files. The script outputs the list of agent file paths.

For EACH agent file path, read its content (Read tool) and invoke the Agent tool in PARALLEL:

```
Agent(
  subagent_type="general-purpose",
  description=f"Review-{role}",
  prompt=<full agent .md content as system prompt + the instruction to write findings YAML to the agent's declared output path>
)
```

Wait for ALL agents to complete. Each agent should have written a YAML findings file to `.claude/agents/review-{SLUG}-{date}/findings/{role}.yml`.

### Step 4 — Consolidate findings

```bash
python3 .claude/skills/review/scripts/consolidate_findings.py \
  --findings-dir .claude/agents/review-{SLUG}-{date}/findings/ \
  --output .claude/knowledge-base/reviews/{SLUG}-review-{date}.md
```

The script reads each YAML, deduplicates, classifies, writes the consolidated markdown report.

### Step 5 — Re-validate quality gates

```bash
python3 .claude/skills/implement/scripts/run_validation.py {SLUG}
```

Capture the verdict. If FAIL, the review final verdict is automatically NEEDS_FIXES.

### Step 6 — Edge-case coverage

```bash
python3 .claude/skills/review/scripts/edge_case_coverage.py \
  --plan .claude/knowledge-base/plans/{SLUG}-plan.md \
  --tests-dir tests/
```

Capture covered / partial / missing.

### Step 7 — Halt decision

Inspect the consolidated report:

- Any `severity: BLOCKER` → final verdict NEEDS_FIXES; HALT merge
- More than 2 `severity: HIGH` not all dismissed-with-ADR → final verdict NEEDS_FIXES; HALT merge
- ≤ 2 HIGH with documented mitigation + MEDIUM/LOW/INFO + no BLOCKER → READY_TO_MERGE
- Coverage of edge cases < 80% OR systemic issues exceeding targeted fixes → final verdict NEEDS_DEEPER

### Step 8 — Report and recommend next step

Append the final verdict + handoff decision to the consolidated report (already written in Step 4; just append the verdict block).

Print summary to stdout:

```
=== /review complete ===
Plan: {SLUG}
Branch: {feature-branch}
Agents spawned: N (list)
Findings: N total (BLOCKER: N, HIGH: N, MEDIUM: N, LOW: N, INFO: N)
Edge-case coverage: N/M covered
Verdict: READY_TO_MERGE / NEEDS_FIXES / NEEDS_DEEPER

Report: .claude/knowledge-base/reviews/{SLUG}-review-{date}.md
Audit trail: .claude/agents/review-{SLUG}-{date}/

Next: 
  - READY_TO_MERGE: open PR with gh pr create OR copy report into existing PR
  - NEEDS_FIXES: loop back to /implement {SLUG} to address BLOCKER + HIGH
  - NEEDS_DEEPER: re-run /review with broader scope (more agents or domain refinement)
```

## Inviolable rules during orchestration

- NEVER modify code on `develop` — only writes review artifacts (YAML findings + markdown report + agent audit trail)
- NEVER skip Step 3 (parallel agents) to move faster — the rigor IS the agents
- NEVER approve with unresolved BLOCKER findings
- NEVER fabricate findings or fill in default findings to "look thorough"
- NEVER auto-merge — final merge is human decision after consuming the report
