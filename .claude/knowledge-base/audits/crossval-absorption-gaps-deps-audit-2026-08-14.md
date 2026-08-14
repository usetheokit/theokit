# Deps Audit: crossval-absorption-gaps

**Date:** 2026-08-14
**Mode:** plan-bound:`crossval-absorption-gaps`
**Verdict:** `PASS_WITH_CAVEATS`
**Hard caps triggered:** none *(after remediation — see § Remediation applied)*

## Summary

- **Ecosystems detected:** npm only (`package.json` + `pnpm-lock.yaml`). No `pyproject.toml`, `Cargo.toml` or `go.mod` at the repo root — the 3 Rust files in the tree are fixtures, not a crate.
- **Deps audited:** 52 direct at the root + the full transitive graph via the lockfile.
- **Vulnerabilities found (whole graph):** 0 CRITICAL, **16 HIGH**, 5 MODERATE, 2 LOW — across 7 packages.
- **Vulnerabilities reaching a consumer (`--prod`):** **0 CRITICAL, 0 HIGH**, 4 MODERATE, 2 LOW.
- **Outdated:** not enumerated this run — see § Auditor coverage.
- **Allowlist hits:** 0 active, 0 expired (`rules/deps-audit-allowlist.txt` is empty).
- **Auditor coverage:** `pnpm audit` **ran**; `osv-scanner` **ran** (cross-check); `pnpm outdated` **NOT run**; `pip-audit` / `cargo audit` / `govulncheck` **N/A** (no manifest for those ecosystems).

**Cross-check agreement:** `pnpm audit` and `osv-scanner` returned **identical** counts (16 HIGH / 5 MODERATE / 2 LOW over the same 7 packages). Per anti-pattern #6, npm findings are never taken from `osv-scanner` alone; the two sources agreeing raises confidence that neither dataset is lagging here.

---

## The finding that matters, stated precisely

The repository's dependency graph carries **16 HIGH-severity advisories**. None of them is a dependency this plan declares, and none of them reaches someone who installs a published package:

| Question | Answer | Evidence |
|---|---|---|
| Is any vulnerable package a **direct** dep of the root? | **No** | `{esbuild, js-yaml, brace-expansion, shell-quote, immutable, fast-uri, mermaid} ∩ {52 direct deps}` = ∅ |
| Is any in a published package's `dependencies` / `peerDependencies`? | **No** | Scanned all 6 `packages/*/package.json` — zero hits |
| Do any reach a consumer install? | **No** | `pnpm audit --prod` → `{critical: 0, high: 0, moderate: 4, low: 2}` |
| Does this plan introduce or upgrade any of them? | **No** | Plan `## Dependencies § New` is `(none)` |

**Interpretation.** All 16 HIGH live in the **build toolchain** (`esbuild`, `mermaid` for diagrams, `js-yaml` and `brace-expansion` inside glob/config chains, `shell-quote`, `immutable`, `fast-uri`). Every one is a denial-of-service or a dev-server file-read class. They are real and they are **out of scope for this plan** — which is why the verdict is not `FAIL_INSECURE`: the golden rule's hard cap is on a CRITICAL/HIGH CVE in a **declared** dependency, and this plan declares none.

That is not the same as "safe to ignore". See § Recommended next steps — it warrants its own audit item, not a silent pass inside someone else's plan.

---

## Vulnerabilities (sorted by severity)

Reported verbatim from the auditors. Every entry carries its fix version, per anti-pattern #8.

### HIGH — `brace-expansion` (7 advisories, transitive, dev-only)
- **Class:** DoS via exponential-time expansion / unbounded intermediate arrays
- **Fixed in:** `>=1.1.16`, `>=1.1.17`, `>=1.1.18` (1.x line) · `>=5.0.7`, `>=5.0.8`, `>=5.0.9` (5.x line)
- **Path:** transitive under glob/minimatch chains in the dev toolchain
- **Diff suggestion:** none at the manifest level — not a direct dep. Resolve via a lockfile refresh (`pnpm update brace-expansion --recursive`) or a `pnpm.overrides` entry.

### HIGH — `js-yaml` (3 advisories, transitive, dev-only)
- **Class:** quadratic CPU consumption via merge-key chains and `!!omap` resolution
- **Fixed in:** `>=3.15.0`, `>=3.15.1` (3.x) · `>=4.3.0` (4.x)
- **Diff suggestion:** none at the manifest level — transitive.

### HIGH — `shell-quote` (1) · `immutable` (1) · `fast-uri` (2)
- **Classes:** quadratic-complexity DoS in `parse` · 32-bit trie overflow → unrecoverable DoS · host confusion via literal backslash / backslash authority
- **Fixed in:** `>=1.9.0` · `>=4.3.9` · `>=3.1.4`, `>=3.1.5`
- **Diff suggestion:** none at the manifest level — transitive.

### MODERATE — `mermaid` (4) and `js-yaml` (1)
- **Classes:** prototype pollution (config APIs, architecture diagrams), CSS injection to sibling elements, infinite-loop DoS in XY charts, radar-diagram DoS
- **Fixed in:** `>=11.16.1` (mermaid) · `>=3.15.0` (js-yaml)
- **Note:** `mermaid` reaches the `--prod` surface (it is among the 4 moderates there) — it renders diagrams in documentation surfaces.

### LOW — `esbuild` (1) · `mermaid` (1)
- **Classes:** arbitrary file read while running the **development** server · prototype pollution via configuration APIs
- **Fixed in:** `>=0.28.1` · `>=11.16.1`
- **Note on `esbuild`:** the advisory is scoped to the dev server. It does not describe a build-output vulnerability.

---

## Outdated (non-vulnerable)

**Not enumerated in this run.** `pnpm outdated` was not executed against a 52-direct-dep root plus 6 workspace packages, because the plan introduces zero dependencies and no version pin — so no outdated finding could change its verdict.

Reported rather than silently omitted, per anti-pattern #5: **this is a coverage gap.** A standalone `/deps-audit` (Mode 1) should run it. The consequence for this plan is limited to the `plan_dep_major_outdated_unpinned` identifier, which cannot fire on a plan with no declared new deps.

---

## Plan validation

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@theokit/sdk` `^4.49.0` | Existing | yes — optional peer in `packages/{theo,agents}` | yes — no advisory against `@theokit/*` | n/a (existing) | OK |
| `zod` | Existing | yes — in the dependency set | yes | n/a (existing) | OK |
| `vitest` `^3` | Existing (dev) | yes — root `test: vitest run` | yes | n/a (existing) | OK |
| `node:fs` / `node:crypto` | Existing (stdlib) | n/a | n/a | n/a | OK |
| **(no NEW deps)** | New | n/a | n/a | **yes** — three candidates evaluated and rejected with reasons (`semver`, `proper-lockfile`, `env-paths`) | OK |

The `New` row is empty, and the Rule 9 column is nonetheless populated: the golden rule demands evidence that alternatives were *considered*, and "we added nothing" is only credible when it names what was weighed and why the ladder stopped earlier. Three candidates, three rejections, each resolved at rung 2 (stdlib) or rung 4 (already installed).

---

## Remediation applied during this audit

**Initial run produced `INVALID_PLAN_DEPS` (cap 49)** — stable identifier `plan_dependencies_section_missing`. The plan (v1.1) had no `## Dependencies` section at all, which is hard cap #4 in the golden rule.

This was a genuine defect in the plan, not a false positive: the `/to-plan` canonical template does not include a `## Dependencies` section, while `deps-audit-golden-rule.md` § 3 requires one. The plan was authored faithfully to the template and still failed the gate.

**Fix:** the section was added to the plan with all three sub-tables (Existing / New / Removed) and the Rule 9 evaluation. Re-checked: hard cap cleared.

> **Process finding worth carrying upstream:** the plan template and the deps-audit golden rule disagree about a mandatory section. Every plan produced by `/to-plan` will hit this cap. The durable fix is to add `## Dependencies` to `skills/to-plan/templates/plan-template.md` — recorded here as a follow-up, not silently patched per-plan.

---

## Recommended next steps

1. **Do not fold the 16 HIGH into this plan.** They are pre-existing, dev-only, and unrelated to its 12 gaps. Absorbing them would be the scope creep this ecosystem's anti-patterns forbid.
2. **File them as their own work item** — a lockfile refresh (`pnpm update --recursive` on the seven packages) or targeted `pnpm.overrides`. Most have fixes available on the same major, so the expected blast radius is small.
3. **Run a Mode 1 `/deps-audit`** to close the `pnpm outdated` coverage gap this report declares open.
4. **Add `## Dependencies` to the plan template** so the next plan does not hit the same cap.
5. Proceed to `/plan-confidence crossval-absorption-gaps`.

---

## Honest limits of this audit

- **`pnpm outdated` did not run** — outdated-version findings are unmeasured, not absent.
- **Transitive-path attribution is coarse.** `pnpm audit --prod` establishes that no HIGH reaches a consumer install; it does not enumerate which dev tool pulls each advisory. Precise paths would need `pnpm why <pkg>` per package.
- **`mermaid` appears in the `--prod` moderate set.** It is called out because "0 HIGH in prod" is a narrower claim than "prod is clean" — 4 moderates and 2 lows remain there.
- **No dep was upgraded and no manifest was edited** — read-only by contract (anti-patterns #1, #7). Every diff above is a suggestion for a human.
