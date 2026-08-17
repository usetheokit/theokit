# Deps-Audit Golden Rule

Locked unbreakable contract that `/deps-audit` reads to score findings and gate `/plan-confidence`. Mirrors the dogfood/code-quality golden-rule pattern: locked sections require an ADR to change; per-project sections are tuned in `deps-audit-allowlist.txt`.

Without this file, `/deps-audit` emits `INVALID` with flag `deps_audit_golden_rule_missing`.

## § 1 — Verdict tokens (LOCKED)

| Verdict | Score cap | Meaning | Downstream action |
|---|---|---|---|
| `PASS` | 100 | No CVE; every declared dep is on a current major. | Proceed to `/plan-confidence`. |
| `PASS_WITH_CAVEATS` | 89 | Outdated MAJOR without ADR OR LOW CVE. | Proceed; caveats logged. |
| `FAIL_MEDIUM` | 70 | At least one MEDIUM CVE on a declared dep. | Loop back to plan or add allowlist entry with ADR. |
| `FAIL_INSECURE` | 49 | HIGH or CRITICAL CVE on a declared dep (unallowlisted). | **Blocks `/plan-confidence`** — requires version bump or allowlist + ADR. |
| `INVALID_PLAN_DEPS` | 49 | Plan `## Dependencies` section missing / version unset / Rule 9 column empty. | Loop back to `/to-plan` to fix structurally. |
| `INVALID` | 0 | This golden rule missing OR allowlist malformed. | Stop the cycle; surface to human. |

## § 2 — Severity rubric (LOCKED)

| Finding | Verdict cap | Stable identifier |
|---|---|---|
| CRITICAL CVE on declared dep (unallowlisted) | `FAIL_INSECURE` (49) | `cve_critical_{ecosystem}` |
| HIGH CVE on declared dep (unallowlisted) | `FAIL_INSECURE` (49) | `cve_high_{ecosystem}` |
| MEDIUM CVE on declared dep (unallowlisted) | `FAIL_MEDIUM` (70) | `cve_medium_{ecosystem}` |
| LOW CVE on declared dep (unallowlisted) | `PASS_WITH_CAVEATS` (89) | `cve_low_{ecosystem}` |
| Outdated MAJOR version without ADR | `PASS_WITH_CAVEATS` (89) | `outdated_major_{ecosystem}` |
| Plan `## Dependencies` section missing | `INVALID_PLAN_DEPS` (49) | `plan_missing_dependencies_section` |
| Declared dep version not pinned in plan | `INVALID_PLAN_DEPS` (49) | `plan_dep_version_unset` |
| Allowlist entry malformed | `FAIL_INSECURE` (49) | `deps_allowlist_malformed_entry` |
| This file (`deps-audit-golden-rule.md`) missing | `INVALID` (0) | `deps_audit_golden_rule_missing` |

## § 3 — Hard caps (LOCKED)

In order; first failure short-circuits the verdict:

| # | Check | Flag |
|---|---|---|
| 1 | `deps-audit-golden-rule.md` exists and parses | `deps_audit_golden_rule_missing` |
| 2 | `deps-audit-allowlist.txt` parses without syntax errors | `deps_allowlist_malformed_entry` |
| 3 | No declared dep has CRITICAL or HIGH CVE (unallowlisted) | `cve_critical_*` / `cve_high_*` |
| 4 | Plan-bound mode: `## Dependencies` section present and complete | `plan_missing_dependencies_section` / `plan_dep_version_unset` |

## § 4 — Allowlist mechanism (LOCKED)

The allowlist downgrades CVE findings by ONE severity level (CRITICAL → MEDIUM, HIGH → MEDIUM, MEDIUM → LOW, LOW → ignored). Format documented in `deps-audit-allowlist.txt`. Hard rules:

| Property | Rule |
|---|---|
| Entry format | `ECOSYSTEM | PACKAGE | VERSION_RANGE | CVE_ID | SUNSET (YYYY-MM-DD) | RATIONALE` |
| Sunset window | ≤ 90 days from entry creation |
| Expired entry | IGNORED — finding re-fires at full severity |
| Malformed entry | Emits `deps_allowlist_malformed_entry` HARD finding |
| Adding an entry | Requires CHANGELOG entry under `[Unreleased] § Changed` AND an ADR for HIGH/CRITICAL exemptions |

## § 5 — Detector contract (LOCKED)

Detectors are external tools — never reimplemented (Unbreakable Rule 9).

| Ecosystem | Vulnerability scanner | Outdated-version source |
|---|---|---|
| npm | `npm audit` + `osv-scanner` cross-check | `npm outdated` |
| Python | `pip-audit` + `osv-scanner` | `pip list --outdated` |
| Rust | `cargo audit` | `cargo outdated` |
| Go | `govulncheck` + `osv-scanner` | `go list -u -m all` |

Missing binary → emit `auditor_unavailable_{tool}` soft-cap finding; never fabricate clean output.

## § 6 — Per-project tuning (PER-PROJECT — EDIT THIS)

- Maintain `deps-audit-allowlist.txt` with sunset hygiene.
- Override default severity floors in a project ADR only when defaults are demonstrably wrong (e.g., an air-gapped product can downgrade outdated-MAJOR caps).

## § 7 — When this rule may change

Per `cycle-rule-schema.md § Golden Rule Change Protocol`. No rule-specific deviations.

## § 8 — Failure modes the rule guards against

- Adding a dep without checking CVE history.
- "Just upgrade later" pattern that never happens.
- Silent allowlist accumulation past sunset.
- Rule-9 violations: reimplementing CVE detection instead of using scanners.
- Manifest-only scans missing transitive vulnerabilities.

## Cross-references

- Schema: `cycle-rule-schema.md`
- Cycle: `cycle-plan.md` (wired between `/edge-case-plan` and `/plan-confidence`)
- Skill: `skills/deps-audit/SKILL.md`
- Allowlist: `deps-audit-allowlist.txt`
- Unbreakable Rule 9 (CLAUDE.md § 9) — do not reinvent CVE scanners
