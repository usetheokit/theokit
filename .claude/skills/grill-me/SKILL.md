---
name: grill-me
version: 0.1.0
requires: []
description: Interview the user one question at a time until shared understanding on a plan/feature/design is reached. Walks the decision tree branch by branch, resolving dependencies between decisions. For every question, explores the codebase first (Grep/Read) if the answer is there; only asks the user when the answer requires intent/preference/business context. Persists the conversation to knowledge-base/grills/{slug}-grill.md as input for /to-plan. Use BEFORE /to-plan when the feature is non-trivial AND the user has not yet articulated requirements precisely, or when the user explicitly says "grill me". SKIP for trivial fixes or when /to-plan can already synthesize from context.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write
argument-hint: "{topic-slug}"
---

# `/grill-me` — Interview-driven discovery

Interview the user about a plan/design until shared understanding is reached. Walks the decision tree branch by branch.

Operationalizes the 95%-confidence principle (`/home/paulo/.claude/CLAUDE.md § 1`): instead of producing a plan from vague requirements and iterating with `/edge-case-plan` + `/plan-improve` later, surface and resolve the requirements gaps **before** any plan is written.

## Cycle contract

This skill is **Phase 0 (optional)** of [`cycle-plan`](../../rules/cycle-plan.md). Invoke when the topic is non-trivial AND requirements are not yet precise. Skip when:

- The fix is trivial (single-line, obvious bug).
- The user already wrote a detailed spec.
- Pure refactor with no behavior change.
- The decision tree has < 3 branches (just write the plan directly).

**Read `cycle-plan.md § Phase 0` before invoking.** This SKILL.md retains phase-specific protocol.

## Process

### Step 1 — Resolve the topic

Take the slug as input. If no slug is passed, ask the user for a one-sentence description of what they want to do, then derive a kebab-case slug.

### Step 2 — Codebase-first (MANDATORY)

For every question that COULD be answered by reading the repo, do that instead. Only ask the user when the answer requires:

- **User intent** — "do you want X or Y for the end user?"
- **Business preference** — "is performance or correctness more important here?"
- **External information** — deadlines, constraints, stakeholders, deps not yet declared.

Anti-pattern (FORBIDDEN): asking the user something a 30-second Grep would answer. Examples of forbidden questions:

- "Does this codebase use TypeScript or JavaScript?" → check `package.json` / `tsconfig.json`.
- "Where is the auth middleware?" → Grep for `auth` or `middleware`.
- "Is there a CI config?" → `ls .github/workflows .gitlab-ci.yml`.

### Step 3 — One question at a time

For each question, provide your **recommended answer with reasoning**. Wait for the user to confirm, override, or refine before moving on. NEVER ask multiple questions in the same turn (no "Q1: ...? Q2: ...?").

Question shape:

```
**Question N**: <one specific question>

**Recommended answer**: <your best guess + reasoning in 2-3 lines>

(awaiting your confirmation, override, or refinement)
```

### Step 4 — Walk the decision tree

Identify each decision point. Resolve dependencies: root decisions before branch decisions. Example tree for "add user authentication":

```
Authentication mechanism (root)
├── Identity source (DB / OIDC / SAML)
│   ├── Session storage (cookie / JWT)
│   │   └── Refresh-token rotation strategy
│   └── Password rules (if DB)
├── Authorization model (RBAC / ABAC / scopes)
└── Recovery flow (email / SMS / TOTP backup)
```

Resolve root first ("identity source"). The branch decisions become tractable only after the root is fixed.

### Step 5 — Stop conditions

Stop grilling when ANY of these fires:

| Condition | Verdict |
|---|---|
| Decision tree fully resolved (every branch has a concrete answer) | `READY_FOR_PLAN` |
| User says "ok, that's enough" / "let's plan now" / equivalent | `READY_FOR_PLAN` (note what's unresolved) |
| 15 questions reached without convergence | `NEEDS_SPLIT` (topic too large; recommend splitting) |
| Unknown prior art surfaced during grilling (e.g., "how do other tools solve this?") | `NEEDS_DISCOVERY` (recommend `/discover-plan` first) |

### Step 6 — Persist the conversation

Write the full Q&A log to `knowledge-base/grills/{slug}-grill.md` with frontmatter:

```yaml
---
slug: <topic-slug>
date: YYYY-MM-DD
questions_asked: N
decisions_resolved: M
verdict: READY_FOR_PLAN | NEEDS_SPLIT | NEEDS_DISCOVERY
---

# Grill: {topic}

## Decision tree resolved

(numbered list of decisions with answers)

## Q&A log

### Q1: <question>
**Recommended**: <recommendation>
**User decision**: <what user chose>

### Q2: ...
```

This file is the input contract for `/to-plan`. The plan's `## Context` section MUST cite specific grill decisions it implements.

### Step 7 — Recommend next step

Based on the verdict:

| Verdict | Recommended next |
|---|---|
| `READY_FOR_PLAN` | `/to-plan {topic-slug}` — the plan reads `knowledge-base/grills/{slug}-grill.md` as primary context |
| `NEEDS_SPLIT` | Suggest 2-3 sub-topics; re-run `/grill-me {sub-topic}` on each |
| `NEEDS_DISCOVERY` | `/discover-plan {topic-slug}` first; return to `/grill-me` after the blueprint lands |

## Anti-patterns

1. **Asking what Grep would answer.** Always codebase-first.
2. **Multi-question turns** ("Q1: ...? Q2: ...?"). One question, one turn.
3. **Continuing past 15 questions.** Means the topic is too large — split.
4. **Not persisting to disk.** The plan needs to cite the grill output; ephemeral conversations rot.
5. **Asking without a recommended answer.** Socratic blocking is anti-help. Your job is to grill AND propose.
6. **Grilling trivial topics.** A 1-line fix doesn't need an interview.
7. **Grilling when the user already wrote a spec.** Read the spec; ask only about gaps.

## What this skill does NOT do

- It does NOT write the plan — that's `/to-plan` reading the grill output.
- It does NOT explore prior art — that's `/discover-plan` (recommended when verdict is `NEEDS_DISCOVERY`).
- It does NOT validate technical feasibility — that's `/edge-case-plan` + `/plan-confidence` later in the chain.

## Related

- Phase 0 of: [`cycle-plan.md`](../../rules/cycle-plan.md) — optional, for vague topics
- Downstream: `/to-plan` reads `knowledge-base/grills/{slug}-grill.md` when present
- Sibling when discovery is needed: `/discover-plan`
- 95%-confidence principle: `/home/paulo/.claude/CLAUDE.md § 1`
