# Clean Code — Default Conventions (FALLBACK)

## Naming

- Functions: verbs (`compute_score`, `parse_plan`).
- Predicates: question form (`is_valid`, `has_alternatives`).
- Constants: SCREAMING_SNAKE_CASE.
- Variables: snake_case (Python), camelCase (TS), snake_case (Rust).
- Length: short names for short scopes; longer names for longer scopes. No 1-letter except loop indices.

## Function size

- Default budget: ≤ 50 lines per function.
- Exception: a single sequential pipeline without branching may be longer if reading it top-to-bottom requires no jumps.

## Comments

- Comments explain WHY, not WHAT (code already says what).
- Outdated comments are worse than no comments — DELETE them when refactoring.
- TODO comments MUST include either: a date, a name, or a tracking-issue ref. Naked `TODO` is rot.

## Dead code

- No commented-out code in committed files.
- Unused imports / functions — DELETE.
- "We might need this later" → use git history if needed later.

## Error handling

- Errors propagate explicitly (`Result<T, E>` in Rust, exceptions in Python, etc.).
- No silent failures.
- No catch-all `except Exception:` without re-raising or logging.

## Plan implications

- Each task's "Acceptance Criteria" should include `code-audit` check passes (complexity ≤ 10, file ≤ 500 LoC by default).
- ADRs should not propose violations of clean code without explicit justification.

## How `/plan-confidence` checks Clean Code

- Plan DoD should reference at least one code-audit check (complexity, lint, size).
- ADRs proposing exceptions (e.g., "this function will be 200 lines for now") MUST justify in Consequences.
