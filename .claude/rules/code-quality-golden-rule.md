# Code-Quality Golden Rule

Locked unbreakable contract that `/code-quality` reads to score findings, decide verdicts, and gate handoff to `/review`. **This file is the Source of Truth for the severity rubric, the allowlist mechanism, and the verdict score caps.** It mirrors the dogfood-golden-rule pattern: locked sections that require an ADR to change, and per-project sections for tuning.

Without this file, `/code-quality` emits `INVALID` with flag `code_quality_golden_rule_missing` and refuses to score.

## § 1 — Verdict tokens (LOCKED)

`/code-quality` MUST emit one of the following verdicts. They are aligned with the canonical matrix in `cycle-rule-schema.md`.

| Verdict | Score cap | Meaning | Downstream action |
|---|---|---|---|
| `PASS` | 100 | No findings above INFO. Toolchain available for every enabled language. | Proceed to `/review`. |
| `PASS_WITH_CAVEATS` | 89 | Only soft-floor findings (mutation score 60-79%, etc.). | Proceed to `/review`; caveats logged in the audit report and PR description. |
| `FAIL_SOFT` | 70 | Soft-cap findings (orphan exports, mutation < 60%, auditor unavailable). | `/review` MAY proceed if explicit ADR dismisses each soft cap; otherwise loop back to `/implement`. |
| `FAIL_HARD` | 49 | Hard-cap findings (dead code unallowlisted, symbol fabrication). | **Blocks `/review`.** Loop back to `/implement`. |
| `INVALID` | 0 | Structural integrity broken (this file missing, malformed allowlist entry, golden-rule corruption). | Stop the cycle. Surface to human. |

A new verdict token requires an ADR + an entry in `cycle-rule-schema.md` § Canonical verdict vocabularies.

## § 2 — Severity rubric (LOCKED)

In order of severity ceiling; first hit wins (smallest cap is the verdict).

| Finding | Verdict cap | Stable identifier |
|---|---|---|
| Symbol fabrication (production code references undefined symbol) | `FAIL_HARD` (49) | `symbol_fabrication_{language}` |
| Dead exported symbol with no caller and no test (unallowlisted) | `FAIL_HARD` (49) | `dead_code_unallowlisted_{language}` |
| Allowlist entry malformed (parse error) | `FAIL_HARD` (49) | `allowlist_malformed_entry` |
| Code-quality golden rule missing (this file) | `INVALID` (0) | `code_quality_golden_rule_missing` |
| Plan missing `## Critical paths` section (Mode 2 + D4 mutation only) | `FAIL_SOFT` (70) | `plan_missing_critical_paths_section` |
| Orphan exported symbol (no importer, exporting from a public package) | `FAIL_SOFT` (70) | `soft_cap_orphan_export_{language}` |
| Mutation score < 60% on declared critical paths | `FAIL_SOFT` (70) | `soft_cap_mutation_score_low_{language}` |
| Auditor unavailable (tool missing for enabled language) | `FAIL_SOFT` (70) | `auditor_unavailable_{tool}` |
| Mutation score 60-79% on declared critical paths | `PASS_WITH_CAVEATS` (89) | `soft_floor_mutation_score_medium_{language}` |
| Dead internal symbol (private function with no caller) | `PASS_WITH_CAVEATS` (89) | `dead_internal_symbol_{language}` |
| Unused parameter (often refactor leftover) | `PASS_WITH_CAVEATS` (89) | `unused_parameter_{language}` |

## § 3 — Hard caps (LOCKED)

Hard caps are findings that cap the verdict at `FAIL_HARD` (score 49) or below. They cannot be downgraded by the allowlist alone — they require either a code fix or an explicit ADR.

In order; first failure short-circuits the verdict:

| # | Check | Flag |
|---|---|---|
| 1 | This file (`code-quality-golden-rule.md`) exists and parses | `code_quality_golden_rule_missing` |
| 2 | `code-quality-allowlist.txt` parses without syntax errors | `allowlist_malformed_entry` |
| 3 | No production source references an undefined symbol (per detector D2 introspection) | `symbol_fabrication_{language}` |
| 4 | No exported public symbol is dead AND not allowlisted (per detector D1) | `dead_code_unallowlisted_{language}` |

A finding flagged as hard cap MAY only be downgraded via:
- **Code fix** — the underlying issue is resolved in the source.
- **ADR + allowlist entry with sunset** — entered in `code-quality-allowlist.txt` with a justification and a sunset date ≤ 90 days. The allowlist downgrades severity by ONE level (HARD → SOFT_CAP).

## § 4 — Allowlist mechanism (LOCKED)

`code-quality-allowlist.txt` accepts entries that exempt SPECIFIC findings, with mandatory sunset. The format is documented in the allowlist file itself; the contract here is:

| Property | Rule |
|---|---|
| Entry format | `IDENTIFIER | FILE:LINE | SUNSET (YYYY-MM-DD) | RATIONALE` |
| Sunset window | ≤ 90 days from entry creation date |
| Downgrade | ONE severity level (HARD → SOFT_CAP, SOFT_CAP → SOFT_FLOOR) |
| Expired entry | IGNORED — finding re-fires at full severity; entry listed under "Allowlist hits — expired" in the audit report |
| Malformed entry | Emits `allowlist_malformed_entry` HARD finding; aborts allowlist processing |
| Adding an entry | Requires CHANGELOG entry under `[Unreleased] § Changed` |
| Bypassing the allowlist (e.g., `# noqa: code-quality`) | FORBIDDEN — every exemption goes through this file |

## § 5 — Detector contract (LOCKED)

Detectors run in fixed order. Each detector MUST be subprocess-isolated, never modify source code, and emit findings as structured JSON.

| Detector | Tool family | Languages | What it asserts |
|---|---|---|---|
| D1 — Dead code | vulture, knip, cargo-udeps, deadcode | Python, TS, Rust, Go | No exported symbol unreachable from a caller or a test |
| D2 — Symbol fabrication | tree-sitter + registry introspection | All enabled | Every imported symbol resolves to a real definition |
| D3 — Cross-package wiring | ast-grep | All enabled | Public exports have at least one importer (soft cap) |
| D4 — Mutation testing | mutmut, stryker | Python, TS (Rust+Go deferred) | Mutation score ≥ floor on declared critical paths |

A detector MAY be added to this table only via an ADR + corresponding implementation in `skills/code-quality/scripts/detectors/`.

## § 6 — Per-project tuning (PER-PROJECT — EDIT THIS)

Thresholds for the detectors live in `code-quality-thresholds.txt`. The keys are stable; the values are per-project. Defaults are shipped in `skills/code-quality/defaults/thresholds.txt` and may be promoted to `rules/code-quality-thresholds.txt` for project-specific overrides.

Each project SHOULD:

1. Enable its languages in `code-quality-languages.txt` (this is per-project by design).
2. Tune thresholds in `code-quality-thresholds.txt` only when defaults are demonstrably wrong for the codebase.
3. Maintain `code-quality-allowlist.txt` with sunset hygiene (no entry older than its sunset).

## § 7 — When this rule may change

Per `cycle-rule-schema.md § Golden Rule Change Protocol`. Rule-specific deviations:

- Changing a verdict token = breaking the cycle contract (requires ADR).
- Adding a new detector = expanding the D-series (requires ADR + implementation in `skills/code-quality/scripts/detectors/`).
- Loosening a hard cap to a soft cap = downgrading the gate (requires ADR with risk assessment).

## § 8 — Failure modes the rule guards against

- LLM-generated code with fabricated symbol references slipping past unit tests.
- Dead exports accumulating because nobody runs cleanup.
- Mutation score regression masked by line-coverage growth.
- Allowlists growing stale forever (sunset enforcement).
- `/code-quality` PASS being mistaken for `/review` PASS (different gates, different vocabularies).

## Cross-references

- Schema for cycle rules: `cycle-rule-schema.md`
- Cycle rule: `cycle-code-quality.md`
- Skill: `skills/code-quality/SKILL.md`
- Languages enablement: `code-quality-languages.txt`
- Thresholds: `code-quality-thresholds.txt`
- Allowlist: `code-quality-allowlist.txt`
- Defaults shipped with the skill: `skills/code-quality/defaults/`
