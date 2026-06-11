# Portable installation — `/code-quality` skill

Standalone setup for the multi-language code-quality gate. Works inside the TheoMemory monorepo (default) OR in any other project that adopts the skill via copy.

## Python deps (managed via pyproject.toml)

```bash
cd .claude/skills/code-quality
bash setup.sh
```

Creates `.venv/`, installs `tree-sitter`, `tree-sitter-languages`, `requests`, `pyyaml`, `pytest`, `pytest-mock`, `pytest-cov`, `ruff` in editable mode.

## External CLIs (NOT installed by setup.sh)

Each detector wraps an external tool. Without the tool installed, the detector emits a `auditor_unavailable_{tool}` SOFT_CAP Finding (cap 70) per the golden rule.

| Tool | Purpose | Install command | Pinned version |
|---|---|---|---|
| `knip` | TypeScript dead code | `npm install -g knip` | `^6.14` |
| `vulture` | Python dead code | `pip install 'vulture>=2.14,<3'` | `^2.14` |
| `cargo-udeps` | Rust unused deps | `cargo install cargo-udeps --locked` (needs `cargo +nightly`) | `^0.1` |
| `deadcode` | Go reachability | `go install golang.org/x/tools/cmd/deadcode@v0.45.0` | `v0.45.0` |
| `@stryker-mutator/core` | TS mutation testing | `npm install -g @stryker-mutator/core` (binary stays `stryker`) | `^9.6` |
| `mutmut` | Python mutation testing | `pip install 'mutmut>=3.5'` | `^3.5` |
| `osv-scanner` | Cross-eco CVE (recommended dev prereq) | `go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest` | latest |

**Pinned versions** were established via `/deps-audit` on 2026-05-22. Update via a new audit run before bumping.

## Verifying installation

```bash
cd .claude/skills/code-quality
.venv/bin/pytest tests/ -v
```

Expected pre-build: most tests FAIL (RED phase) until detectors are implemented. After full implementation (T0.4 through T6.5), pytest should be all GREEN with ≥ 90% coverage on changed files.

## Running standalone

```bash
# Mode 1 — audit current repo
python3 scripts/run_code_quality.py

# Mode 2 — bind to a plan
python3 scripts/run_code_quality.py {plan-slug}

# Offline mode (disables D2 symbol fabrication)
python3 scripts/run_code_quality.py --no-network

# JSON only (no Markdown audit file — used by /plan-confidence runtime integration)
python3 scripts/run_code_quality.py {plan-slug} --no-audit-write --json-out -
```

## Adapting to a different project

The skill assumes the host project has:
- `.claude/rules/code-quality-languages.txt` declaring which languages habilitar
- `.claude/rules/code-quality-thresholds.txt` with per-detector knobs
- `.claude/rules/code-quality-allowlist.txt` (seed-empty acceptable)
- `.claude/rules/code-quality-golden-rule.md` defining the unbreakable contract
- `.claude/knowledge-base/audits/` directory (will be created if absent)

Copy `defaults/thresholds.txt` and `defaults/languages.txt` to `.claude/rules/` and customize per host project. The golden rule + allowlist must be authored explicitly (no defaults — these are policy decisions).
