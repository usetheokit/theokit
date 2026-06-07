# File Size Limits — Default Budget (FALLBACK)

## Default ceiling

**500 lines per file.**

This is a soft default. Project-specific limits documented in `.claude/rules/architecture.md § Module hygiene` (or an equivalent rules file) override.

## Why 500?

- Beyond 500, files become hard to navigate.
- Indicator of SRP violation: a 500+ LoC file usually has multiple responsibilities.
- Empirical: most production codebases set 300-1000 LoC ceilings; 500 is the median.

## Project-specific limits

If a project documents its own LoC budget in `.claude/rules/architecture.md` (or an equivalent rules file), it OVERRIDES this default. Common project-specific values seen in practice:

- Rust workspaces: 800 LoC per file (more generous than 500 because Rust idioms are verbose)
- TypeScript: 400 LoC per file (stricter due to JSX/React component norms)
- Python: 500 LoC per file (matches this default)

Project rules win; this default is FALLBACK only.

## Plan implications

- Each task's "Files to edit" must NOT push a file over the budget. If a task adds 200 lines to a 450-line file, that's 650 — violation.
- Tasks that exceed budget must include a refactor sub-task to split the file.

## How `/plan-confidence` checks size

- For each file mentioned in `Files to edit` (existing files), check current LoC.
- If task description suggests adding "substantial" content (≥ 50 lines mentioned) AND current file is within 100 LoC of budget, flag for human review.
- This is a SOFT check (not a hard cap).

## ADR exemption

If a plan ADR explicitly justifies exceeding the budget (e.g., "this is a generated file; not subject to size limits"), the file is exempted with the ADR ref.
