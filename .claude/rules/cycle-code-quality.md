# Cycle: CODE-QUALITY

Source of Truth for the post-implementation code-quality audit. Wired between `/implement` and `/review`.

## Purpose

Detect three classes of defect that slip past unit tests and basic linters:

1. **Dead code** — functions, classes, or modules with no reachable caller.
2. **Symbol fabrication** — references to functions/types/modules that do not exist (a frequent failure mode of LLM-generated code).
3. **Wiring gaps** — public exports without the wiring triad (caller + integration test + runtime metric).

These checks are language-aware. Languages enabled in `rules/code-quality-languages.txt` get full coverage; others are skipped with an INFO finding.

## Pre-conditions

- After `/implement` emits `IMPLEMENTATION_COMPLETE`, before `/review`.
- Standalone before merge of a long-running branch.
- Periodic schedule (suggested weekly via `/loop 7d /code-quality`).
- Also invoked **during** `/implement`'s final validation (per ADR 0002 — `cq-gate-in-validate`): `scripts/run_validation.py` calls `/code-quality` via `cq_invoke.invoke()` and fails the validation if the verdict is `FAIL_HARD` or `INVALID`. This makes `/code-quality` a hard gate of `IMPLEMENTATION_COMPLETE`, not just of `/review`.

Do NOT trigger when:
- The branch has uncommitted changes (audit a stable tree).
- No source code exists yet (pre-code phase) — the skill is a no-op then.

## Chain

```
/code-quality {plan-slug-or-empty}
     ↓ detect languages from manifests (go.mod, package.json, pyproject.toml, Cargo.toml)
     ↓ run per-language detectors (dead-code, fabrication, wiring)
     ↓ consolidate findings into severity-classified report
     ↓ verdict: PASS / PASS_WITH_CAVEATS / FAIL_SOFT / FAIL_HARD / INVALID
```

## Phase contracts

| Phase | Input | Output | Hard gate |
|---|---|---|---|
| detect | repo tree | list of enabled languages | at least one manifest present (else NOOP) |
| analyze | per-language detector run | structured findings (file:line, severity, kind) | detector toolchain available for enabled language |
| consolidate | per-language findings | unified report at `knowledge-base/audits/{slug-or-date}-code-quality.md` | report references real file:line — no fabricated citations |
| verdict | report | PASS / PASS_WITH_CAVEATS / FAIL_SOFT / FAIL_HARD / INVALID | severity rubric (`code-quality-golden-rule.md` § 1–2) |

## Severity rubric

The Source of Truth for the rubric — score caps **and** the stable finding
identifiers — is `code-quality-golden-rule.md` § 1–2 (LOCKED). This cycle does not
redefine them. The verdict is the smallest cap among the findings:

| Verdict | Cap | When |
|---|---|---|
| `PASS` | 100 | No finding above INFO. |
| `PASS_WITH_CAVEATS` | 89 | Soft-floor only (dead internal symbol, unused parameter, mutation 60–79%). |
| `FAIL_SOFT` | 70 | Soft-cap (orphan export, mutation < 60%, auditor/toolchain unavailable). |
| `FAIL_HARD` | 49 | Hard-cap (`symbol_fabrication_{language}`, `dead_code_unallowlisted_{language}`). |
| `INVALID` | 0 | Structural integrity broken (golden rule missing/corrupt, allowlist malformed). |

## Hard gates (`FAIL_HARD`)

- `symbol_fabrication_{language}` — at least one production reference points to a name that does not exist in the source tree or in any imported dependency.
- `dead_code_unallowlisted_{language}` — a symbol exported from a public package surface has no caller and no test, and is not allowlisted.

A `FAIL_HARD` verdict blocks `/review`; `INVALID` halts the cycle (surface to human). The fix path for `FAIL_HARD` is back to `/implement` (or a targeted fix branch). A `FAIL_SOFT` MAY proceed to `/review` only with an ADR dismissing each soft cap (per golden rule § 1).

## Stop conditions

- A detector crashes (e.g., parse error in a source file) → halt; surface the parse error; do NOT emit a partial report.
- Toolchain for an enabled language is missing → emit `detector_unavailable_{lang}` finding and continue with the remaining languages.

## Anti-patterns

- Running `/code-quality` on an uncommitted tree — false positives from in-progress code.
- Suppressing findings via inline comments without an ADR — every suppression needs justification.
- Treating `PASS_WITH_CAVEATS` as `PASS` — caveats are explicit, address or document them.
- Running `/code-quality` BEFORE `/implement` finishes — the audit is for post-implementation state.

## Output

- `knowledge-base/audits/{slug-or-date}-code-quality.md` — consolidated report with severity matrix, file:line evidence, and remediation suggestions.
- The verdict is emitted in the report and in the structured JSON (`verdict` field). The process exits non-zero on blocking verdicts (`FAIL_HARD` / `INVALID`).

## Cross-references

- Schema for cycle rules: `rules/cycle-rule-schema.md`
- Skill: `skills/code-quality/SKILL.md` (phase-specific protocol)
- Defaults: `skills/code-quality/defaults/languages.txt`
- Languages enabled per project: `rules/code-quality-languages.txt`
- Downstream: `rules/cycle-review.md` (consumes the audit verdict)
- Upstream: `rules/cycle-implement.md` (must emit `IMPLEMENTATION_COMPLETE` before this runs)
