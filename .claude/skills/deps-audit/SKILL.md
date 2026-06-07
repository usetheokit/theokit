---
name: deps-audit
description: Audit project dependencies for known vulnerabilities (CVEs) and outdated versions across npm, Python, Rust, Go. Auto-detects manifests; runs osv-scanner + npm audit + npm outdated + pip-audit + cargo audit + govulncheck; cross-references a plan's ## Dependencies section; produces diff-style bump suggestions. NEVER edits manifests. Use after /edge-case-plan, before /plan-confidence — or standalone for periodic audits.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "[plan-slug] (optional — bind audit to a plan's Dependencies section)"
---

# Deps Audit

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> See `/home/paulo/.claude/CLAUDE.md` § 1 (95% Confidence).

Audit project dependencies for known vulnerabilities AND outdated versions. Multi-ecosystem (npm, Python, Rust, Go) with auto-detection. **Read-only** by design: NEVER edits manifests; produces diff-style bump suggestions for human application.

**Project rules consumed:**
- `rules/deps-audit-golden-rule.md` — locked contract; unbreakable hard caps (CRITICAL/HIGH CVE in declared dep = BLOCKER).
- `rules/deps-audit-allowlist.txt` — CVE/version allowlist with mandatory rationale + sunset date ≤ 90 days.
- Unbreakable Rule 9 (`/home/paulo/.claude/CLAUDE.md § 9`) — drives the philosophy: use existing scanners (`osv-scanner`, `npm audit`, `pip-audit`, `cargo audit`, `govulncheck`); never reimplement CVE detection.
- `rules/cycle-plan.md` — wired between `/edge-case-plan` and `/plan-confidence`.

---

## Trigger conditions

Invoke this skill when:

- `/edge-case-plan` has just returned PLAN OK and you're about to run `/plan-confidence` (recommended cycle-plan position — see `cycle-plan.md`).
- Standalone audit before merge / release / dogfood evidence collection.
- After adding or upgrading a dependency manually.
- Periodic schedule (suggested weekly via `/loop 7d /deps-audit`).
- A new CVE has been disclosed for a dep you use.
- Renovate/Dependabot opened a PR and you want a local cross-check before merging.

Do NOT invoke when:

- The repo has no auditable manifests (`package.json`, `pyproject.toml`, etc.) AND no plan-slug is passed — report "no auditable surface" + exit gracefully.
- You want to UPGRADE deps automatically — this skill is read-only by contract. Apply diffs manually OR use a separate dependency-upgrade workflow.

---

## Modes

### Mode 1 — Standalone audit

```
/deps-audit
```

Detects all manifests in repo root (excluding `node_modules/`, `.venv/`, `__pycache__/`, `knowledge-base/references/`, `dist/`, `build/`, `target/`), runs the matching auditors, prints a report to stdout. No plan binding; advisory only.

### Mode 2 — Plan-bound audit (RECOMMENDED for cycle-plan)

```
/deps-audit {plan-slug}
```

Reads `knowledge-base/plans/{slug}-plan.md` (or `knowledge-base/discoveries/plans/{slug}-plan.md`), parses its `## Dependencies` section, cross-references every declared dep against:

1. The actual manifest state (or marker `(NEW)` if dep is to be added by the plan).
2. The auditor results (CVE database + outdated versions).

Emits a verdict that participates in `/plan-confidence` gating per the golden rule.

---

## Workflow

### Step 1 — Detect ecosystems

Walk the repo root, skipping the ignore-set above. Collect:

| Ecosystem | Manifest files | Lockfile(s) |
|---|---|---|
| npm | `package.json` | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` |
| Python | `pyproject.toml`, `requirements*.txt` | `uv.lock`, `poetry.lock` |
| Rust | `Cargo.toml` | `Cargo.lock` |
| Go | `go.mod` | `go.sum` |

If no manifest found AND no plan-slug passed → report "no auditable surface" + exit.

### Step 2 — Run auditors (Rule 9 — use what exists)

For each detected ecosystem, run the appropriate tools. The orchestrator MUST tolerate missing binaries (e.g., `osv-scanner` not installed) — report the gap, do NOT fabricate clean output.

#### npm

```bash
npm audit --json
npm outdated --json
# Cross-check with osv-scanner if available
osv-scanner --lockfile=package-lock.json --json
```

#### Python

```bash
# PyPA official, OSV-backed
pip-audit --format json
# If pyproject.toml + uv:
pip-audit --requirement <(uv pip compile pyproject.toml) --format json
# Cross-check
osv-scanner --lockfile=uv.lock --json
osv-scanner --lockfile=poetry.lock --json
```

#### Rust

```bash
cargo audit --json
osv-scanner --lockfile=Cargo.lock --json
```

#### Go

```bash
govulncheck -json ./...
osv-scanner --lockfile=go.sum --json
```

#### Multi-ecosystem unified pass (optional but recommended)

```bash
osv-scanner --recursive --json .
```

Use `osv-scanner` as the cross-ecosystem layer; per-ecosystem auditors as authoritative for their stack (`npm audit` has GitHub Advisory data that may lag in OSV).

### Step 3 — Parse + correlate findings

For every vulnerability found, record:

- CVE ID (or GHSA / OSV ID)
- Affected ecosystem + package + version range
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Fixed version (or "no fix available")
- Allowlist status: not-listed / listed-active / listed-expired (sunset passed → treated as not-listed)

For every outdated finding:

- Package + current version + latest version
- Semver delta: PATCH / MINOR / MAJOR
- Changelog URL (if discoverable in lockfile metadata)

### Step 4 — Cross-reference plan (Mode 2 only)

Parse the plan's `## Dependencies` section. Expected shape (template):

```markdown
## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `<existing-lib>` | `^X.Y.Z` | npm/python/rust/go | Why this dep exists (cite ADR if applicable) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `<new-lib>` (NEW) | `^X.Y.Z` | npm/python/rust/go | Evaluated: alt A (reason rejected), alt B (reason rejected) | Decisive reason |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |
```

For each row, validate:

1. **Existing rows**: package + version actually exist in the current manifest at the declared version (or compatible range).
2. **NEW rows**: package exists on the registry at the declared version; Rule 9 column is non-empty + cites at least one rejected alternative.
3. **All rows**: declared version is NOT affected by any unallowlisted CRITICAL/HIGH CVE per audit output.
4. **Transitive deps**: best-effort check — if `osv-scanner` reports a transitive CVE in a path rooted at the declared dep, surface it as a soft warning (cap 89).

### Step 5 — Emit verdict

See [`deps-audit-golden-rule.md § Severity rubric`](../../rules/deps-audit-golden-rule.md) for the authoritative cap table. Summary:

| Worst finding | Verdict | Plan-confidence cap |
|---|---|---|
| no findings | PASS | none |
| CVE LOW or outdated MAJOR (no ADR) | PASS_WITH_CAVEATS | 89 |
| CVE MEDIUM | FAIL_MEDIUM | 70 |
| CVE HIGH or CRITICAL | FAIL_INSECURE | 49 (INVALID band) |
| Plan deps section missing / version unset / Rule 9 missing | INVALID_PLAN_DEPS | 49 |

### Step 6 — Write report

In **Mode 1**: print full report to stdout.

In **Mode 2**: write to `knowledge-base/audits/{slug}-deps-audit-{date}.md` AND print summary to stdout. The persistent file is the audit trail consumed by `/plan-confidence`.

---

## Output report shape

```markdown
# Deps Audit: {slug or repo}

**Date:** YYYY-MM-DD
**Mode:** {standalone | plan-bound:{slug}}
**Verdict:** {PASS | PASS_WITH_CAVEATS | FAIL_MEDIUM | FAIL_INSECURE | INVALID_PLAN_DEPS}
**Hard caps triggered:** [list of stable identifiers per golden rule; may be empty]

## Summary
- Ecosystems detected: npm, python
- Total deps audited: N (direct: A, transitive: B)
- Vulnerabilities found: X CRITICAL, Y HIGH, Z MEDIUM, W LOW
- Outdated: A major, B minor, C patch
- Allowlist hits: D active, E expired (re-fired)
- Auditor coverage: { npm-audit: ran, pip-audit: SKIPPED — binary not installed, osv-scanner: ran }

## Vulnerabilities (sorted by severity)

### CVE-YYYY-NNNNN — CRITICAL (npm: foo@1.2.3)
- **Fixed in:** ^1.2.5
- **Path:** root → foo
- **Diff suggestion:**
  ```diff
  - "foo": "^1.2.3"
  + "foo": "^1.2.5"
  ```
- **Plan reference (Mode 2):** Plan declares `foo: ^1.2.3` at Existing — to-be-used. Recommend bumping in plan BEFORE `/plan-confidence` runs; otherwise plan-confidence caps at 49.

## Outdated (non-vulnerable)

### npm: bar@2.0.0 → 3.0.0 (MAJOR)
- **Changelog:** {url if discovered}
- **Diff suggestion:** OMITTED for MAJOR — review breaking changes first.

## Plan validation (Mode 2 only)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `<existing-lib>` | Existing | yes (^X.Y.Z) | yes | n/a | OK |
| `<new-lib>` | NEW | n/a (to add) | yes (no known CVE at ^X.Y.Z) | yes | OK |

## Recommended next steps

1. Apply the diff suggestions above to `package.json` / `pyproject.toml` (NEVER let this skill apply them).
2. Re-run `/deps-audit {slug}` to confirm verdict is PASS or PASS_WITH_CAVEATS.
3. Proceed with `/plan-confidence`.
```

---

## Severity rubric (LOCKED — mirrors golden rule)

| Finding | Verdict | Plan-confidence cap | Stable identifier |
|---|---|---|---|
| CRITICAL CVE in declared dep | FAIL_INSECURE | 49 | `plan_dep_critical_cve` |
| HIGH CVE in declared dep | FAIL_INSECURE | 49 | `plan_dep_high_cve` |
| MEDIUM CVE in declared dep | FAIL_MEDIUM | 70 | `plan_dep_medium_cve` |
| LOW CVE in declared dep | PASS_WITH_CAVEATS | 89 | `plan_dep_low_cve` |
| Outdated MAJOR, no ADR pinning | PASS_WITH_CAVEATS | 89 | `plan_dep_major_outdated_unpinned` |
| Plan `## Dependencies` missing | INVALID_PLAN_DEPS | 49 | `plan_dependencies_section_missing` |
| Plan dep version unspecified | INVALID_PLAN_DEPS | 49 | `plan_dep_version_unspecified` |
| Plan NEW dep no Rule 9 eval | INVALID_PLAN_DEPS | 49 | `plan_new_dep_no_rule9_evaluation` |
| Plan declares dep not on registry | INVALID_PLAN_DEPS | 49 | `plan_dep_not_on_registry` |
| Auditor failed to run / not installed | varies (NEVER `PASS`) | 70 if HIGH/CRIT untestable | `auditor_unavailable_{name}` |

Allowlisted findings (within sunset) downgrade by ONE severity level: CRITICAL → MEDIUM, HIGH → LOW, etc. Expired allowlist entries are ignored.

---

## Anti-patterns

1. **NEVER edit manifests** — read-only by contract. Diffs are SUGGESTIONS for human application. Auto-upgrade lives in a separate skill (does not yet exist by design).
2. **NEVER skip the lockfile** — `npm audit` against `package.json` alone misses transitive vulnerabilities. The lockfile is the source of truth for what's actually installed.
3. **NEVER silently ignore findings** — every CRITICAL/HIGH MUST appear in the report even if allowlisted. Allowlist DOWNGRADES severity; it does not HIDE the finding.
4. **NEVER fabricate CVE IDs** — every CVE in the report must come verbatim from the auditor's JSON output. No memory-based citations.
5. **NEVER claim "no vulnerabilities" when an auditor failed** — if `osv-scanner` crashed or `pip-audit` isn't installed, report the gap honestly. Half-audited is worse than not-audited (false sense of safety). The verdict for an unavailable auditor in a stack that has untestable HIGH-severity exposure caps at 70.
6. **NEVER use `osv-scanner` alone for npm** — its npm dataset can lag GitHub Advisory; pair with `npm audit`. Cross-check both.
7. **NEVER auto-upgrade** — even if the bump is "obviously safe". Human decides. Per Unbreakable Rule 1 (95% confidence) and Rule 4 (Git safety).
8. **NEVER cite a CVE without its fix-version (or explicit "no fix available")** — empty fix data is a fabrication signal; either the tool failed to report it OR we hallucinated.
9. **NEVER skip Rule 9 column on NEW deps** — see golden rule; this is a hard cap. "Picked X because it's popular" is NOT Rule 9 evaluation. Need rejected alternatives + reasons.
10. **NEVER allowlist a CRITICAL CVE without sunset ≤ 30 days** — golden rule requires aggressive sunset for high severity; rejecting it via allowlist is a stopgap, not a destination.
11. **NEVER bypass via `--force` / `--skip-audit` / `--accept-cves` flags** — they do not exist by design (golden rule constructor invariant).
12. **NEVER use `knowledge-base/references/` clones as part of the audit surface** — read-only zone; their deps are not OUR responsibility.

---

## Rollback

| Artifact | Rollback procedure |
|---|---|
| Report at `knowledge-base/audits/{slug}-deps-audit-{date}.md` | Delete file; no further state to revert. |
| Allowlist entry at `rules/deps-audit-allowlist.txt` | Standard git revert of the line addition. |
| (No manifest changes ever — skill is read-only.) | n/a |

---

## Cross-references

- Golden rule: [`rules/deps-audit-golden-rule.md`](../../rules/deps-audit-golden-rule.md)
- Allowlist: [`rules/deps-audit-allowlist.txt`](../../rules/deps-audit-allowlist.txt)
- Wired into: [`rules/cycle-plan.md`](../../rules/cycle-plan.md) (new phase between `/edge-case-plan` and `/plan-confidence` — v1.1)
- Renovate/Dependabot complementary setup: `.github/dependabot.yml` or `renovate.json` — passive GitHub-side infra, out of scope for this skill
- Unbreakable Rule 9: [`/home/paulo/.claude/CLAUDE.md § 9`](file:///home/paulo/.claude/CLAUDE.md) (Do Not Reinvent the Wheel)
- Sibling skills: `/plan-confidence` (consumes this skill's verdict), `/dogfood` (also a hard-cap gate on plans)

## Downstream wiring required (NOT yet shipped — follow-up)

Per the locked policy in `plan-confidence-golden-rule.md` § When this rule may change, EXTENDING the gate (adding `/deps-audit` as a new hard cap to plan-confidence) requires an ADR. The skill works **standalone** today; the integration with `/plan-confidence` will be tracked in a follow-up `/to-plan deps-audit-plan-confidence-wiring`.

Until that integration ships, the user MUST invoke `/deps-audit {slug}` manually after `/edge-case-plan` and BEFORE `/plan-confidence`, and respect its verdict by hand.
