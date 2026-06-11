---
name: code-quality
description: Audit project code for dead symbols, fabricated APIs, cross-package orphans, and weak test quality across Go, Python, TypeScript, and Rust (per rules/code-quality-languages.txt enablement). Auto-detects manifests; runs knip + vulture + cargo-udeps + deadcode + tree-sitter symbol fabrication checks + ast-grep cross-package wiring + stryker/mutmut mutation testing. Read-only by design (never edits code). Use after /implement completes its halt-loop, before /review begins — or standalone for periodic audits.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "[plan-slug] (optional — bind audit to a plan's Critical paths section)"
---

# Code Quality

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (95% Confidence).

Audit project code for dead symbols, fabricated APIs, cross-package orphan exports, and weak test quality. Multi-ecosystem (Python, TypeScript, Rust, Go) with auto-detection + declarative language enablement. **Read-only** by design: NEVER edits source code; produces findings + verdict for human application.

**Project rules consumed:**
- `.claude/rules/code-quality-golden-rule.md` — locked unbreakable contract.
- `.claude/rules/code-quality-languages.txt` — declarative enablement per language.
- `.claude/rules/code-quality-thresholds.txt` — per-detector floors + behavioral knobs.
- `.claude/rules/code-quality-allowlist.txt` — findings exemptions with mandatory sunset.
- Unbreakable Rule 9 (`/home/paulo/.claude/CLAUDE.md § 9`) — drives philosophy: use existing tools (knip, vulture, cargo-udeps, deadcode, stryker, mutmut, tree-sitter); never reimplement.
- `.claude/rules/cycle-implement.md` — wired between halt-loop and `/review` handoff (when extended via T6.1).

---

## Trigger conditions

Invoke this skill when:

- `/implement` has just completed (halt-loop emitted `IMPLEMENTATION_COMPLETE`) and you're about to handoff to `/review`.
- Standalone audit before merge / release / dogfood evidence collection.
- After significant LLM-generated code lands and you want to surface fabricated symbols + dead code.
- Periodic schedule (suggested weekly via `/loop 7d /code-quality`).

Do NOT invoke when:

- The repo has zero ENABLED languages in `code-quality-languages.txt` AND no plan-slug provided — exits with INFO "no auditable languages".
- You want to AUTO-FIX findings — this skill is read-only by contract. Apply suggestions manually.

---

## Modes

### Mode 1 — Standalone audit

```
/code-quality
```

Detects all manifests at repo root (respecting `DEFAULT_SKIP_DIRS` exclusions), runs ENABLED detectors against current code state. Prints report to stdout.

### Mode 2 — Plan-bound audit (RECOMMENDED for cycle-implement integration)

```
/code-quality {plan-slug}
```

Reads `.claude/knowledge-base/plans/{slug}-plan.md`. Slug resolution order (strict — per EC-6):

1. `.claude/knowledge-base/plans/{slug}-plan.md`
2. `.claude/knowledge-base/plans/completed/{slug}-plan.md` (already merged)
3. **REFUSE** if slug matches only `.claude/knowledge-base/discoveries/plans/{slug}-plan.md` (discovery plan; different schema) — emits helpful error pointing to `/discover-confidence`.

Parses plan's `## Critical paths` section (when present, drives D4 mutation testing scope). Writes audit Markdown to `.claude/knowledge-base/audits/{slug}-code-quality-{date}.md`. Emits JSON verdict to stdout (or `--json-out PATH`).

---

## Workflow

### Step 1 — Load config + auto-detect manifests

Load (in order):
1. `.claude/rules/code-quality-languages.txt` → which languages habilitar
2. `.claude/rules/code-quality-thresholds.txt` → per-detector knobs
3. `.claude/rules/code-quality-allowlist.txt` → findings exemptions

For each ENABLED language, check for its manifest at repo root (`pyproject.toml` / `package.json` / `Cargo.toml` / `go.mod`). Languages with no manifest emit INFO Finding and are skipped (not failed).

### Step 2 — Run detectors per language

For each (language, manifest-present) pair, instantiate the language's detector (`scripts/detectors/{lang}.py::{Lang}Detector`) and run:

- **D1 — Dead code**: subprocess external CLI (vulture/knip/cargo-udeps/deadcode); parse output; emit `Finding(severity=HARD, detector="d1_dead_code")` for unallowlisted entries.
- **D2 — Symbol fabrication**: tree-sitter AST parse of changed/new files; extract imports + calls; validate against registry (PyPI/npm/crates.io/Go proxy) with 24h cache; introspect lib signatures via Python `inspect` / TS Compiler API. Skip module-local imports (relative/crate::/self-module) + monorepo subpath exports.
- **D3 — Cross-package wiring** (soft cap): ast-grep enumeration of public exports across the repo; compute bipartite map (exports → importers); emit SOFT_CAP Finding for orphan exports.
- **D4 — Mutation testing** (soft cap): mutmut (Python) + stryker (TS) scoped to `## Critical paths` declared by plan (Mode 2 only); Rust + Go DEFERRED to v0.2 (graceful skip INFO).

### Step 3 — Apply allowlist (with sunset)

For each Finding, check `code-quality-allowlist.txt`:
- ACTIVE entry (today ≤ sunset) → downgrade severity by ONE level (HARD → SOFT_CAP, SOFT_CAP → SOFT_FLOOR).
- EXPIRED entry (today > sunset) → IGNORED; finding re-fires at full severity. List in audit "Allowlist hits — expired".
- Malformed entry → emit `allowlist_malformed_entry` HARD Finding.

### Step 4 — Compute verdict (smallest cap wins)

Per [`code-quality-golden-rule.md § Severity rubric`](../../rules/code-quality-golden-rule.md):

| Finding | Cap | Stable identifier |
|---|---|---|
| Dead code unallowlisted | 49 (INVALID) | `dead_code_unallowlisted_{language}` |
| Symbol fabrication | 49 (INVALID) | `symbol_fabrication_{language}` |
| Plan missing `## Critical paths` (Mode 2 + D4) | 70 | `plan_missing_critical_paths_section` |
| Allowlist entry malformed | 49 | `allowlist_malformed_entry` |
| Orphan export | 70 | `soft_cap_orphan_export_{language}` |
| Mutation score < 60% | 70 | `soft_cap_mutation_score_low_{language}` |
| Mutation score 60-79% | 89 | `soft_floor_mutation_score_medium_{language}` |
| Auditor unavailable | 70 | `auditor_unavailable_{tool}` |

### Step 5 — Emit JSON + Markdown report

**JSON** (stdout or `--json-out PATH`):

```json
{
  "verdict": "PASS | PASS_WITH_CAVEATS | FAIL_SOFT | FAIL_HARD | INVALID",
  "score_cap": 49 | 70 | 89 | 100,
  "hard_caps_triggered": ["..."],
  "soft_caps_triggered": ["..."],
  "findings_by_detector": {...},
  "languages_audited": [...],
  "languages_skipped": [...],
  "skip_reasons": {...},
  "report_path": "...",
  "schema_version": "0.1.0"
}
```

**Markdown** (Mode 2: written to `.claude/knowledge-base/audits/{slug}-code-quality-{date}.md`; Mode 1: stdout). See `templates/code-quality-report.md` for the template.

---

## CLI flags

| Flag | Purpose | Default |
|---|---|---|
| `{plan-slug}` (positional, optional) | Mode 2 binding | none → Mode 1 |
| `--json-out PATH` | Write JSON to file (use `-` for stdout) | stdout |
| `--audit-out PATH` | Write Markdown report to file | derived from slug + date |
| `--no-audit-write` | Skip Markdown report (JSON only, for `/plan-confidence` consumption per T6.5) | false |
| `--languages-rule PATH` | Override languages config path | `.claude/rules/code-quality-languages.txt` |
| `--thresholds-rule PATH` | Override thresholds config path | `.claude/rules/code-quality-thresholds.txt` |
| `--allowlist PATH` | Override allowlist path | `.claude/rules/code-quality-allowlist.txt` |
| `--no-network` | Disable D2 (symbol fabrication); single INFO per language (per EC-25) | false |

---

## Anti-patterns

1. **NEVER edit source code** — read-only by contract.
2. **NEVER add `--force` / `--skip-checks` / `--accept-caveats`** — golden rule constructor invariant.
3. **NEVER fabricate findings** — every Finding MUST come from a real detector run (subprocess + parse).
4. **NEVER claim "no dead code" when D1 auditor failed** — emit `auditor_unavailable_{tool}` SOFT_CAP honestly.
5. **NEVER consume the allowlist silently for malformed entries** — emit `allowlist_malformed_entry` HARD (EC-4).
6. **NEVER scan `.claude/knowledge-base/references/`** — `DEFAULT_SKIP_DIRS` covers it; read-only zone for the entire ecosystem.

---

## Rollback

| Artifact | Procedure |
|---|---|
| Audit report at `.claude/knowledge-base/audits/{slug}-code-quality-{date}.md` | Delete file; no further state. |
| Allowlist entry at `.claude/rules/code-quality-allowlist.txt` | Standard git revert. |
| Registry cache at `~/.cache/code-quality/registry/*.json` | Delete files; auto-rebuilds next run. |

---

## Roadmap (v0.2 deferred items)

- **D4 mutation testing for Rust + Go** — DEFERRED via T4.3 ADR. Need to evaluate `cargo-mutants` vs `gremlins` (Go) before committing.
- **D2 member-access introspection for TypeScript** — currently package-name check only. Member-access introspection via tsc subprocess deferred (cost not justified for v0.1).
- **D2 member-access introspection for Rust** — same reason as TS; cargo metadata introspection deferred.
- **Skylos (Python dead code)** — current vulture wrapper is robust; Skylos defer to v0.2 when it ships 1.0.
- **`--auto-fix` flag** — explicitly out of scope; auto-fix is a separate skill that does not yet exist by design.

---

## Cross-references

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Languages config: [`.claude/rules/code-quality-languages.txt`](../../rules/code-quality-languages.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Sibling skill (model arquitetural): [`/deps-audit`](../deps-audit/SKILL.md)
- Cycle: [`.claude/rules/cycle-implement.md`](../../rules/cycle-implement.md)
