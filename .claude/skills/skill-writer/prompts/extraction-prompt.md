# Skill-Writer Extraction Prompt

You are extracting load-bearing knowledge from a blueprint to produce a candidate skill. The blueprint is at `{SOURCE_BLUEPRINT_PATH}`. The output is a SKILL.md at `.claude/skills/generated/{TOPIC_SLUG}-patterns/SKILL.md` derived from the template at `.claude/skills/skill-writer/templates/generated-skill-template.md`.

## Your contract

Read the source blueprint carefully. Then fill the template substitution markers using ONLY content from the blueprint. Do not invent, do not infer beyond what is stated.

### Substitution markers

| Marker | Source in blueprint | Format guideline |
|---|---|---|
| `{TOPIC_SLUG}` | Argument from caller — typically the blueprint slug minus `-blueprint` | kebab-case |
| `{TOPIC_TITLE}` | Blueprint H1 line, minus "Blueprint: " prefix | Title case |
| `{SOURCE_BLUEPRINT_SLUG}` | Argument from caller | kebab-case |
| `{SOURCE_BLUEPRINT_PATH}` | `.claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md` | Absolute or repo-relative |
| `{YYYY-MM-DD}` | Today's date (UTC) | ISO-8601 date |
| `{DESCRIPTION}` | Synthesize from blueprint Objective + Recommendations. Single paragraph. Include ≥2 specific "Use when..." trigger phrases referencing concrete paths/domain terms. | Max 3 sentences, ~80 words, plain prose |
| `{APPLIES_WHEN}` | Bulleted list of trigger phrases extracted from blueprint Objective + Recommendations | 3-6 bullets, each "Use when ..." or "Consult when ..." |
| `{PATTERNS}` | One pattern section per blueprint ADR. See pattern template below. | Markdown H3 sections |
| `{RECOMMENDATIONS}` | The blueprint's `## Recommendations` table or list, lightly normalized | Table or bulleted list, preserve linked rules |
| `{QUICK_REF_TABLE}` | Blueprint's `## Cross-cutting Comparison` table, condensed to 3-5 most relevant columns | Markdown table |
| `{KEY_CITATIONS}` | Top 5-10 load-bearing citations. A citation is "load-bearing" if it appears in 2+ different blueprint sections. | Bulleted list of `.claude/knowledge-base/references/{project}/{path}:N — {1-line description}` |
| `{BLUEPRINT_VERDICT}` | Read from `.claude/knowledge-base/reviews/{slug}-confidence-*.md` if exists; otherwise re-run `/discover-confidence` quickly | SHIPPABLE / SHIPPABLE_WITH_CAVEATS |
| `{BLUEPRINT_SCORE}` | Same source as verdict | Numeric 0-100 |

### Pattern template (substitute one per blueprint ADR)

For each `### D{N}` in the blueprint's `## ADRs` section, generate:

```markdown
### Pattern {N}: {ADR title minus "D{N} — " prefix}

**Decision:** {ADR Decision verbatim from blueprint}

**Why:** {ADR Rationale verbatim from blueprint}

**Other approaches considered:** {ADR Alternatives considered verbatim}

**When this pattern fits / doesn't:** {ADR Consequences, rephrased as "fits when X / doesn't fit when Y" if possible; otherwise verbatim Consequences}

**Evidence:** {extract `.claude/knowledge-base/references/...` citations from the blueprint sections that ground this ADR — limit to 3}
```

### Description guidelines (LOAD-BEARING for /to-plan Step 0 discovery)

The `description` field in the frontmatter is what `/to-plan` Step 0 scans to decide whether to load this skill. Bad descriptions = skill is never consumed.

Good description shape:

```
Patterns for <domain> distilled from <source>. Use when planning <specific area 1>, when designing <specific area 2>, or when weighing <specific decision>. Anchored on <evidence — .claude/knowledge-base/references/ paths or project rule names>.
```

Concrete example (good):

```
Patterns for pgvector schema design distilled from Project B's production-shaped implementation. Use when planning src/local/ adapter for OurProject, when designing the schema of vector-bearing tables, when choosing pgvector index type (HNSW vs IVFFlat), or when wiring Alembic migrations for embedding-dimension changes. Anchored on .claude/knowledge-base/references/project-b/project-b/orm/ and the Project B exploration ADRs.
```

Concrete example (bad — vague):

```
Useful patterns about memory and stuff.
```

The validator will WARN if `description` has <2 "Use when..." phrases OR lacks concrete context references.

## Hard rules (cannot bend)

1. **Never invent patterns.** If the blueprint has 2 ADRs, the generated skill has 2 patterns. Not 3, not 1.
2. **Never invent citations.** Every `.claude/knowledge-base/references/{path}:N` in your output MUST appear verbatim in the source blueprint. The validator will FAIL the skill if any citation doesn't.
3. **Never include shell-execution patterns.** Generated skills are informational. Anything that looks executable (bash blocks with rm/curl/sudo, Bash() permissions, hooks) is forbidden — validator will FAIL.
4. **Never overwrite.** If `.claude/skills/generated/{TOPIC_SLUG}-patterns/` already exists OR `.claude/skills/{TOPIC_SLUG}-patterns/` already exists, abort with error. Do not merge automatically.
5. **Source blueprint must be ≥ SHIPPABLE_WITH_CAVEATS.** If verdict is INVALID or NON_SHIPPABLE, abort BEFORE writing anything.

## Output

After the substitution is complete, write the result to `.claude/skills/generated/{TOPIC_SLUG}-patterns/SKILL.md` AND write a 4-line marker file at `.claude/skills/generated/{TOPIC_SLUG}-patterns/.source-blueprint`:

```
{SOURCE_BLUEPRINT_SLUG}
{BLUEPRINT_VERDICT}
{BLUEPRINT_SCORE}
{generation timestamp ISO-8601 UTC}
```

Print a summary to stdout with: candidate path, source blueprint path, N patterns extracted, N citations included, next step recommendation (`/skill-validator {TOPIC_SLUG}-patterns`).
