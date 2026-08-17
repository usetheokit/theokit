---
name: quality-init
version: 0.1.0
requires: []
description: Rigorously read a project codebase and emit tailored Claude Code quality-gate hooks (PostToolUse) that block code smells on every Write/Edit. Detects languages, frameworks, existing linter configs, and test directories, then calibrates adaptive thresholds (max_complexity / max_function_lines / max_nesting_depth / max_parameters / max_file_lines / duplicate_min_lines) from the project's actual p90 metrics — never generic defaults. Generates Python hook scripts + settings.json patch. Use this BEFORE starting any coding session where you want automatic quality enforcement via hooks.
user-invocable: true
allowed-tools: Bash Read Glob Grep Write
argument-hint: "TARGET [--force] [--allow-missing-tools] [--strict] [--out PATH] [--verbose]"
---

# quality-init — calibrate quality-gate hooks for a real project

> **INQUEBRAVEL — 95% Confidence Gate**
>
> NAO FACA NADA SE NAO TIVER 95% DE CONFIANCA.
> SEMPRE QUE PRECISAR DE UMA DECISAO DO USUARIO, APRESENTE
> OPCOES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (95% Confidence).

This skill is a **one-shot rigorous initializer**. It walks a target codebase, measures actual code metrics, and emits calibrated Claude Code hooks that block code smells on every `Write` and `Edit` operation. Because it is a skill (not a plugin), it leaves no state behind and is safe to invoke in any project.

**Project rules consumed:**
- `/home/paulo/.claude/CLAUDE.md` § 7 (Testes) — hook scripts follow AAA pattern in tests
- `/home/paulo/.claude/CLAUDE.md` § 8 (Error Handling) — fail-fast, fail-clear
- `/home/paulo/.claude/CLAUDE.md` § 9 (Nao Reinvente) — uses `ast` stdlib for Python, `lizard` for multi-lang
- `/home/paulo/.claude/CLAUDE.md` § 10 (KISS) — four focused modules, each under 300 lines

---

## When to invoke

Invoke this skill when:

- Starting a new project and you want automatic code-smell blocking from day one.
- Adopting Claude Code hooks for the first time in an existing project.
- After a major project shift (new language, framework swap, tooling change) that invalidates previous thresholds.
- When you want to recalibrate thresholds based on the project's current state.

Do NOT invoke when:

- The project already has a `.claude/hooks/check_quality.py` and you're happy with the thresholds — edit `smell_types.py` directly instead.
- You want to run a one-time code quality audit — use `/code-quality` or `/loop-code-review` instead.

---

## Argument parsing

The argument is a single line: `TARGET [FLAGS...]`. The first positional token is the target path; everything else is flags.

| Flag | Meaning | Default |
|---|---|---|
| `--out PATH` | Where to write hook files | `<TARGET>/.claude/hooks/` |
| `--force` | Overwrite existing hook files | refuse if files exist (exit 3) |
| `--strict` | Use strict thresholds (lower limits) instead of adaptive p90 | adaptive |
| `--allow-missing-tools` | Continue even when `lizard` is not installed | fail with exit 2 |
| `--verbose` | Stream stage progress to stderr | quiet |
| `--skip-tests` | Exclude test directories from threshold calibration | include tests |
| `--no-settings-patch` | Skip patching `.claude/settings.json` (only emit hook scripts) | patch settings |

---

## What to do now

1. **Parse `$ARGUMENTS`** into `TARGET` plus the flag set. If `TARGET` is empty after stripping flags, print the usage line from the YAML frontmatter and stop.

2. **Invoke the initializer.** The Python script does all 10 mandatory stages:

   ```bash
   python3 scripts/init_quality_gates.py \
       --target "$TARGET" \
       ${OUT:+--out "$OUT"} \
       ${FORCE:+--force} \
       ${STRICT:+--strict} \
       ${ALLOW_MISSING_TOOLS:+--allow-missing-tools} \
       ${VERBOSE:+--verbose} \
       ${SKIP_TESTS:+--skip-tests} \
       ${NO_SETTINGS_PATCH:+--no-settings-patch}
   ```

   The 10 stages — all mandatory, no shortcuts:

   1. `validate_target` — directory exists, non-empty, readable, contains source files
   2. `detect_languages` — Python / TS / JS / Go / Rust / Java / C / C++ with file counts and LOC
   3. `detect_frameworks` — Django, FastAPI, Flask, Express, Next.js, React, Gin, Axum, Spring, etc.
   4. `detect_existing_linters` — ruff, eslint, pylint, flake8, golangci-lint, clippy, biome, prettier configs
   5. `detect_test_dirs` — locate test directories and test file patterns per language
   6. `calibrate_thresholds` — **adaptive, not generic**:
      - `max_complexity = max(10, p90(cyclomatic_complexity))`
      - `max_function_lines = max(20, p90(function_length))`
      - `max_nesting_depth = max(3, p90(nesting_depth))`
      - `max_parameters = max(4, p90(parameter_count))`
      - `max_file_lines = max(300, p90(file_length))`
      - `duplicate_min_lines = 4` (fixed — not calibrated)
   7. `smoke_test_tools` — verify `python3` available (required), `lizard` optional for multi-lang
   8. `generate_hook_scripts` — emit 4 Python files to `<TARGET>/.claude/hooks/`:
      - `check_quality.py` — entry point (reads PostToolUse JSON, runs checks, emits block/allow)
      - `smell_types.py` — calibrated thresholds + fix instructions
      - `smell_python.py` — Python AST analyzer (complexity, length, nesting, params)
      - `smell_checks.py` — orchestrator (language routing, file-level checks, duplicate detection)
   9. `patch_settings_json` — merge PostToolUse hook into `<TARGET>/.claude/settings.json`
   10. `validate_round_trip` — invoke `check_quality.py` with a synthetic event to verify it runs without error

3. **Interpret the exit code:**

   | Exit | Meaning | Action |
   |---|---|---|
   | 0 | Hooks emitted, smoke tests passed | Print the human report. List calibrated thresholds. Recommend the user review thresholds in `smell_types.py`. |
   | 1 | Target invalid / empty / no source files | Surface stderr verbatim; suggest pointing at a directory with source code. |
   | 2 | Required tool missing (python3) | List missing tools; never proceed silently. |
   | 3 | Hook files already exist, `--force` not set | Suggest `--force` to overwrite OR `--out` to write elsewhere. |
   | 4 | Internal IO / parse error | Surface stderr; do not try to recover blindly. |
   | 5 | Settings.json patch conflict | Surface the conflict; suggest `--no-settings-patch` and manual merge. |

---

## What gets generated

### Hook scripts (`<TARGET>/.claude/hooks/`)

**`check_quality.py`** — Entry point invoked by Claude Code. Reads PostToolUse JSON from stdin, extracts `file_path`, runs smell checks, emits `{"decision": "block", "reason": "..."}` when violations found.

**`smell_types.py`** — All thresholds in one place. Calibrated from the project's actual metrics. Each threshold has a comment showing the source (p90 measured value vs minimum floor).

```python
# Calibrated from project metrics on YYYY-MM-DD
# Source: p90(cyclomatic_complexity) = 8, floor = 10 -> using floor
MAX_COMPLEXITY = 10
MAX_FUNCTION_LINES = 25      # p90 = 25, floor = 20 -> using p90
MAX_NESTING_DEPTH = 3        # p90 = 2, floor = 3 -> using floor
MAX_PARAMETERS = 4           # p90 = 3, floor = 4 -> using floor
MAX_FILE_LINES = 300         # p90 = 280, floor = 300 -> using floor
DUPLICATE_MIN_LINES = 4      # fixed
DUPLICATE_MIN_OCCURRENCES = 2
```

**`smell_python.py`** — Python-specific AST analysis: cyclomatic complexity (counting `if/for/while/try/except/assert` + boolean operators), function line span, nesting depth, parameter count.

**`smell_checks.py`** — Orchestrator: routes files by extension, runs file-level checks (length, duplicates), delegates to `smell_python.py` for `.py` files, optionally to `lizard` for JS/TS/Go/Rust/Java/C/C++.

### Settings patch (`<TARGET>/.claude/settings.json`)

Merges this hook configuration into existing settings (preserving all other keys):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 <TARGET>/.claude/hooks/check_quality.py"
          }
        ]
      }
    ]
  }
}
```

If PostToolUse already has entries, the new hook is **appended** (not replacing).

---

## Threshold calibration logic

The calibration is **adaptive**: it measures actual code metrics from the project and uses the higher of (measured p90, minimum floor).

### Why p90 and not p50 or max?

- **p50** is too lenient — half the codebase already exceeds it, so the hook would block constantly on existing patterns.
- **max** is too lenient — one outlier function would set the threshold absurdly high.
- **p90** means "90% of your existing code already passes this threshold." The hook blocks only the worst 10% of new code — aggressive enough to improve quality, lenient enough to not cause friction on every write.

### Strict mode (`--strict`)

Ignores measured metrics and uses absolute minimums:

| Metric | Strict value |
|---|---|
| `max_complexity` | 10 |
| `max_function_lines` | 20 |
| `max_nesting_depth` | 3 |
| `max_parameters` | 4 |
| `max_file_lines` | 300 |

These match McCabe's original threshold for complexity and industry-standard recommendations for the rest.

### Skip directories

The hook always skips these directories (no analysis, no blocking):

```
node_modules, __pycache__, .git, dist, build, .next, .venv, venv,
target, vendor, .mypy_cache, .pytest_cache, .ruff_cache, coverage,
.nyc_output, .tox, eggs, *.egg-info
```

Test directories are included by default but can be excluded with `--skip-tests` or by adding them to `SKIP_DIRS` in the generated `smell_checks.py`.

---

## Anti-patterns

1. **NEVER generate hooks that auto-fix code** — hooks are gates, not fixers. Claude fixes the code; hooks verify.
2. **NEVER set thresholds below the minimum floors** — this would cause the hook to block on every write, making Claude unusable.
3. **NEVER silently skip tool verification** — if python3 is missing, exit 2 is final.
4. **NEVER overwrite existing hooks without `--force`** — the user may have hand-tuned thresholds.
5. **NEVER patch settings.json destructively** — always merge, never replace.
6. **NEVER measure thresholds from generated/vendored code** — skip directories exist for this reason.
7. **NEVER use exit code 1 in generated hooks for blocking** — exit code 2 blocks in Claude Code; exit code 1 is a non-blocking warning.

---

## Rollback

| Artifact | Procedure |
|---|---|
| Hook scripts at `<TARGET>/.claude/hooks/check_quality.py` + siblings | Delete the 4 files; no further state. |
| Settings.json patch | Remove the PostToolUse entry manually or `git restore .claude/settings.json`. |

---

## Examples

```
/quality-init .
/quality-init src/ --verbose
/quality-init . --force --strict
/quality-init backend/ --out backend/.claude/hooks/ --no-settings-patch
/quality-init . --allow-missing-tools --skip-tests
```

---

## Why this is a skill (and not a plugin)

- **One-shot:** enters, calibrates, emits hooks, exits. No loop, no persistent state.
- **Multi-project safe:** no hooks installed by the skill itself — it *generates* hooks for the target project.
- **Reusable:** any project can invoke this to bootstrap quality gates calibrated to its own metrics.

---

## Files in this skill

```
quality-init/
├── SKILL.md                           (this file)
├── scripts/
│   ├── init_quality_gates.py          (main initializer — 10 stages)
│   ├── lib/
│   │   ├── __init__.py
│   │   ├── path_safety.py             (prevents path traversal)
│   │   └── yaml_safe.py               (safe JSON read/write)
│   └── hooks/
│       ├── check_quality.py.tpl       (entry point template)
│       ├── smell_types.py.tpl         (thresholds template)
│       ├── smell_python.py.tpl        (Python AST analyzer template)
│       └── smell_checks.py.tpl        (orchestrator template)
└── tests/
    ├── __init__.py
    └── test_init_quality_gates.py     (unit tests)
```
