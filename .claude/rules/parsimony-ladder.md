# Parsimony Ladder

Source of Truth for the parsimony deliberation that precedes writing any production code.
The cheapest line of code is the one you never write.

## Purpose

Unbreakable Rules 9 (Don't Reinvent), 10 (KISS), and 11 (YAGNI) state *what* to value.
This file makes them *operational*: a short, ordered deliberation the agent walks
**before** emitting code, instead of a principle that lives only in prose and is
remembered only when a reviewer flags its absence.

The ladder is a **deliberation step, not a detector** — the agent spends reasoning
on the rungs in order and stops at the first one that resolves the need. It is
proactive (it runs at the point of writing, in the GREEN phase) where the rest of
the cycle is reactive (`/code-quality` finds dead code already written; `/review`
flags scope creep already committed). It closes the gap between "we believe in
minimalism" and "minimalism is enforced at the keystroke".

## The ladder (walk top-down; stop at the first rung that resolves the need)

| # | Rung | Resolution | Rule |
|---|---|---|---|
| 1 | **Does this need to exist?** | No → skip it. Delete the task, do not write the code. | YAGNI (Rule 11) |
| 2 | **Does the standard library do it?** | Yes → use the stdlib. No new dependency, no hand-rolled version. | Don't Reinvent (Rule 9) |
| 3 | **Is there a native platform feature?** | Yes → use it (runtime/framework/OS primitive already present). | Don't Reinvent (Rule 9) |
| 4 | **Is there a dependency already installed?** | Yes → reuse it. Do NOT add a redundant dependency that overlaps one already declared. | Don't Reinvent (Rule 9) |
| 5 | **Can it be one line?** | Yes → one line. Resist the helper/abstraction/config knob nobody asked for. | KISS (Rule 10) |
| 6 | **Only then: write the minimum that works** | The smallest code that makes the RED test pass. | KISS (Rule 10) |

A "need" that fails rung 1 is the cheapest win in the ladder: code that is never
written is never tested, documented, reviewed, or maintained.

## Never on the chopping block (hard guardrail)

The ladder eliminates **unnecessary complexity** — never **necessary correctness**.
The following are NOT "code you can avoid writing" and a parsimony argument MUST
NOT be used to skip them:

- **Tests** — TDD RED before GREEN is non-negotiable (Rule 5 / `rules/testing.md`). "Fewer lines" never means "no failing test first".
- **Input validation at trust boundaries** — per `rules/architecture.md`.
- **Error handling** — fail-fast, explicit, typed (Rule 8). A swallowed exception is not "minimal", it is a latent bug.
- **Security** — auth, secret handling, injection defense. Never trade for terseness.
- **Accessibility** — when the artifact has a human-facing surface.

If applying a rung would weaken any of the above, the rung does not apply. Honesty
(Rule 3) over cleverness: say "this needs the extra code because X", do not silently
ship a fragile shortcut.

## How each rung is enforced across the cycle

The ladder is a single canonical artifact (this file). Other surfaces reference it
rather than restating it (DRY):

| Rung | Where it bites | Mechanism |
|---|---|---|
| 1 (need to exist) | `cycle-plan` (`skills/edge-case-plan/SKILL.md` over-engineering anti-pattern) + `cycle-review` scope-creep flag + GREEN-phase deliberation | reactive + proactive |
| 2, 3, 5 (stdlib / native / one line) | GREEN-phase deliberation in `skills/implement/prompts/implementation-prompt.md`; re-injected each turn by `hooks/userpromptsubmit-inject.sh` | proactive deliberation (not auto-detectable; instruction-grade) |
| 4 (already-installed dependency) | `skills/deps-audit/SKILL.md` evaluates new dependencies; the ladder adds "reuse before you add" upstream of the CVE check | proactive + reactive |
| 6 (minimum that works) | `rules/cycle-implement.md` Chain (`GREEN — minimal code to pass the test`) | proactive, TDD-embedded |

## Anti-patterns

- Using the ladder to justify skipping a test, a validation, or error handling — that is not parsimony, it is negligence (see § Never on the chopping block).
- Skipping rungs 2–4 and hand-rolling a parser/date-math/crypto/HTTP-retry that the stdlib or an installed dep already provides (Rule 9 violation dressed as "it was simpler to write my own").
- Adding a dependency at rung 4 when one already declared covers the need — redundant dep is the inverse of parsimony.
- "While I'm here" generalization at rung 5 — a config knob, a plugin seam, or an interface with a single implementer that nobody requested (YAGNI).
- Treating the ladder as a post-hoc checklist after the code is written. It is a *pre-write* deliberation; running it after the fact only documents complexity already shipped.

## Cross-references

- Unbreakable principles: Rule 9 (Don't Reinvent), Rule 10 (KISS), Rule 11 (YAGNI) — `CLAUDE.md`
- Proactive enforcement point: `rules/cycle-implement.md` (GREEN-phase gate)
- Halt-loop deliberation: `skills/implement/prompts/implementation-prompt.md`
- Skill contract: `skills/implement/SKILL.md`
- Rung 4 dependency reuse vs. CVE audit: `skills/deps-audit/SKILL.md`
- Rung 1 over-engineering catch in planning: `skills/edge-case-plan/SKILL.md`
- Guardrail sources: `rules/testing.md`, `rules/architecture.md`
- Re-injection per turn: `hooks/userpromptsubmit-inject.sh`
