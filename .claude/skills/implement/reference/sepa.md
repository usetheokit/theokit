# SEPA — Specialist Engineer Per-plan Agent

Detailed protocol for the SEPA pattern used by `/implement`. Linked from `SKILL.md § Step 2.5`.

## What is SEPA

A read-only second opinion that the halt-loop consults 3× per iteration. SEPA exists because a fresh-context observer catches things the implementation-focused main session misses: drift from the plan's ADRs, missed edge-case absorption, premature scope creep.

SEPA is **per-plan** (not global). Each `/implement` invocation generates a NEW SEPA agent definition + a NEW paired knowledge skill, both composed from the FULL plan + ADRs + edge-case review + deps audit + plan-confidence report + project rules. The agent becomes extremely specialist on THIS exact plan; the skill is its knowledge librarian, refreshing community best practices via WebSearch on demand.

SEPA is mandatory. The rigor is justified vs the rework cost of catching plan-divergence late.

## Generated artifacts

Per cycle-implement, `/implement` generates BOTH:

| Artifact | Path | Purpose |
|---|---|---|
| **Agent** | `agents/implement-{slug}-{date}/sepa.md` | Orchestrator — read-only observer consulted 3× per iteration |
| **Paired skill** | `skills/implement-{slug}-sepa-knowledge/SKILL.md` | Knowledge layer — domain best practices via WebSearch + plan-specific context hydrated at generation |

The agent + skill pairing is **mandatory** per [Claude Code Skills spec](https://code.claude.com/docs/en/skills) and matches the `/review` per-plan generation convention.

The SEPA agent and its paired skill are both composed from the FULL plan + ADRs + edge-case review + deps audit + plan-confidence report + project rules (verbatim, not summaries). The agent becomes EXTREMELY specialist on this exact plan; the skill becomes the knowledge librarian that refreshes community best practices via WebSearch on demand.

## Composing the SEPA agent file (Claude Code-conformant)

1. Read `templates/sepa-staff-engineer-template.md`.
2. Substitute the context placeholders with verbatim file contents:
   - `{PLAN_SLUG}` — the slug
   - `{DATE}` — today (YYYY-MM-DD UTC)
   - `{FULL_PLAN_CONTENT}` — `knowledge-base/plans/{slug}-plan.md`
   - `{FULL_ADR_FILES_CONCATENATED}` — every `knowledge-base/adrs/ADR-*.md` referenced by the plan
   - `{FULL_EDGE_CASE_REVIEW}` — `knowledge-base/reviews/{slug}-edge-cases-*.md` if present
   - `{FULL_DEPS_AUDIT_REPORT}` — `knowledge-base/audits/{slug}-deps-audit-*.md` if present
   - `{FULL_PLAN_CONFIDENCE_REPORT}` — `knowledge-base/reviews/{slug}-confidence-*.md` if present
   - Project rules — `rules/architecture.md`, `testing.md`, `public-copy.md`, plus golden rules relevant to the plan's domain
3. Assemble the output file as **Claude Code-conformant agent definition**: YAML frontmatter block (between `---` delimiters) + system prompt body. The template documents the exact structure under § "Frontmatter" and § "System prompt body".
4. Write to `agents/implement-{slug}-{date}/sepa.md` (file name is `sepa.md`, NOT `sepa-staff-engineer.md` — alignment with Claude Code agent-discovery naming). This file is the agent DEFINITION, discoverable by Claude Code's subagent system as `subagent_type='implement-{slug}-sepa'`.

## Composing the SEPA-paired knowledge skill (Claude Code Skills-conformant)

After writing the agent file (step 4 above), `/implement` ALSO writes the paired knowledge skill:

1. Read `templates/sepa-knowledge-skill-template.md`.
2. Substitute placeholders specific to the skill (in addition to the agent's placeholders):
   - `{PLAN_GOAL_VERBATIM}` — single-sentence `## Goal` from plan
   - `{ADR_SUMMARY_TABLE}` — markdown table of plan's ADRs (ID + 1-line decision)
   - `{EDGE_CASE_FINDINGS_ABSORBED}` — list of MUST FIX items absorbed (verbatim from edge-case review)
   - `{PROJECT_RULES_RELEVANT}` — filenames from `rules/` cited in plan's ADR Rationale (subset, not all)
   - `{DOMAIN_KEYWORDS}` — extract from plan title + Goal for WebSearch query construction (top 3-5 terms)
3. Assemble as **Claude Code-conformant skill**: YAML frontmatter (between `---` delimiters) + body. Template documents exact structure.
4. Write to `skills/implement-{slug}-sepa-knowledge/SKILL.md`. Skill is auto-discoverable by Claude Code; SEPA agent invokes it via `Skill` tool when consulting community knowledge.

The paired skill is what makes SEPA's findings citable. Without it, SEPA's "best practice" claims would rest on training-data recall (anti-pattern). With it, SEPA invokes the skill, which WebSearches authoritative sources, snapshots them, and returns verbatim canonical quotes.

## Initial brief

Invoke `Agent` tool ONCE at startup with:

- `description`: "SEPA initial brief — {slug}"
- `subagent_type`: `implement-{slug}-sepa` (the agent's `name` field from frontmatter resolves to this — Claude Code auto-discovers the agent file written in step 4 above)
- `prompt`: the iteration-specific question (e.g., "Initial brief: read your role contract + flag any IMMEDIATE issues you see in the plan/ADRs/edge-cases").

The Agent's response is the SEPA's "I have read and accept the role" confirmation, plus any IMMEDIATE flags it caught while reading.

Persist the SEPA's initial-brief response to `knowledge-base/implementations/{slug}/sepa-iterations/initial-brief-response.md`. The main session reviews it before invoking ralph-loop. Note: the response is a LOG OUTPUT (not an agent definition), so it lives under `knowledge-base/implementations/`, NOT under `agents/` (which is reserved for agent definitions per Claude Code spec).

## Per-iteration SEPA invocation

The halt-loop driver (`prompts/implementation-prompt.md`) calls the SEPA THREE times per iteration via `Agent(subagent_type='implement-{slug}-sepa', prompt=<iteration question>, description='SEPA iter {N} {phase}')`:

1. **Before RED**: ask SEPA to recap the picked task + surface gotchas.
2. **After GREEN / before REFACTOR**: ask SEPA to spot SOLID/Clean Code violations + missed cross-references.
3. **Before COMMIT**: ask SEPA to audit the staged diff against DoD checkboxes.

Each invocation is a fresh `Agent` call with the SEPA's frontmatter+system-prompt as the agent definition baseline + the iteration-specific question as the prompt. The added rigor is justified vs the rework cost of caught-late deviations.

## Per-iteration log persistence

After each SEPA response, persist it to `knowledge-base/implementations/{slug}/sepa-iterations/iteration-{N}-{phase}.md` (where `{phase}` ∈ `pre-red`, `post-green`, `pre-commit`). These are LOG OUTPUTS — keep them out of `agents/` to honor the Claude Code agent-discovery convention (the agents directory should contain ONLY agent definitions, not invocation logs).

## SEPA authority + boundaries (locked)

- READ-ONLY. NEVER writes code, ADRs, configs.
- NEVER commits.
- NEVER modifies the plan.
- Outputs structured advice (markdown). Main session retains final decision.
- CRITICAL findings recommend HALT but do NOT block — main session may proceed with explicit justification (per Unbreakable Rule 1: 95% confidence is on the actor).

## Skip conditions (rare)

The SEPA is mandatory by default. Skip only when:

- The plan has zero ADRs AND zero edge-case absorption (rare for `/implement` triggers — by definition the upstream cycle-plan produces both).
- The user explicitly invokes `/implement {slug} --no-sepa` (flag NOT implemented at v1; reserved for future opt-out).

A skipped SEPA must be logged in the implementation contract under "Pre-condition audit" with explicit rationale.
