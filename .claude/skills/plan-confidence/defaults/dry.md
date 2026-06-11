# DRY — Don't Repeat Yourself (FALLBACK)

Each piece of knowledge or logic should have a single, unambiguous representation in the system.

## What DRY is

- Same business rule implemented twice → BAD
- Same constant/threshold defined in two files → BAD
- Same algorithm reimplemented in two languages → may be necessary, but BAD if avoidable

## What DRY is NOT

- "Same code structure" — boilerplate isn't repetition if it's serving distinct concerns
- "Similar but different" — premature abstraction is worse than mild repetition

## Plan implications

ADRs that introduce duplicate logic (same parser, same validator, same algorithm) without justifying why MUST be flagged.

## How `/plan-confidence` checks DRY

The `check_duplication` allowlist (`duplication-allowlist.txt`, `ts-duplication-allowlist.txt` if present) is the enforcement layer at code level. At PLANNING level, plans should:

- Cite DRY in ADR Rationale when explaining why a new utility is being introduced (vs reuse)
- NOT propose helpers/utilities that duplicate existing ones — search the codebase first
