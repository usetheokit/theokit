# Plan-Confidence — Portable Installation

This skill works in **any project** that uses Claude Code. Copy-paste-able with minimal setup.

## What you get

- `/to-plan` — generates implementation plans (requires plan-confidence integration)
- `/plan-confidence {slug}` — scores a plan structurally (M2, $0, deterministic)
- `/plan-improve {slug}` — iteratively improves a plan's score (ralph-loop style)
- Optional: `make check-plan-confidence` — CI gate

## Quick install (3 steps)

### 1. Copy the skill directories

```bash
# In your target project root:
cp -r /path/to/source/.claude/skills/plan-confidence .claude/skills/
cp -r /path/to/source/.claude/skills/plan-improve .claude/skills/
```

That's it for the skills. They auto-detect project root and adapt.

### 2. (Optional) Copy the rule templates

If you want CUSTOMIZED thresholds + golden rule + allowlist (recommended):

```bash
mkdir -p .claude/rules
cp .claude/skills/plan-confidence/templates/plan-confidence-thresholds.example.txt \
   .claude/rules/plan-confidence-thresholds.txt
cp .claude/skills/plan-confidence/templates/plan-confidence-golden-rule.example.md \
   .claude/rules/plan-confidence-golden-rule.md
cp .claude/skills/plan-confidence/templates/plan-confidence-allowlist.example.txt \
   .claude/rules/plan-confidence-allowlist.txt
```

If you DON'T copy these, the skill falls back to **hard-coded defaults** (90/70/50/0 thresholds, golden rule embedded in code, empty allowlist).

### 3. (Optional) Install the CI gate

```bash
mkdir -p scripts
cp /path/to/source/scripts/check-plan-confidence.sh scripts/
chmod +x scripts/check-plan-confidence.sh
```

Add to Makefile if you have one:

```makefile
.PHONY: check-plan-confidence
check-plan-confidence:
	@bash scripts/check-plan-confidence.sh
```

## Or use the automated installer

```bash
bash .claude/skills/plan-confidence/setup.sh /path/to/your/target/project
```

This does steps 1-3 with sensible defaults. See `setup.sh --help` for options.

## What happens out of the box

The skills walk UP from their location to find:

1. **`.claude/` directory** (or `.git/`) → that's the project root
2. **`.claude/rules/`** → that's the source of project rules (if exists)
3. **`.claude/knowledge-base/plans/`** OR **`.claude/plans/`** OR **`plans/`** OR **`docs/plans/`** → plans directory
4. **`.claude/skills/plan-confidence/defaults/`** → fallback rules when (2) is empty

If your project has NONE of `.claude/`, `.git/`, or the conventional structure, the skill falls back to legacy paths. Add a `.claude/` directory at your project root to fix.

## Project requirements

### Required (hard) at runtime

- **Python 3.10+** (the scripts use `int | str` type hints from PEP 604)
- **PyYAML** — `pip install PyYAML`

`setup.sh` checks both and **fails with exit 2/3** if missing. Skill will NOT function without them.

### Optional (for testing/CI)

- `pytest` — run the skill's own test suite
- `ruff` — linting
- `mypy` — strict type checking
- `hypothesis` — property-based tests
- `jsonschema` — output schema validation

Install all-at-once: `pip install PyYAML pytest ruff mypy hypothesis jsonschema`

## Platform support

| Platform | setup.sh | run_structural.py | Notes |
|---|---|---|---|
| **Linux (Ubuntu/Debian/RHEL/...)** | ✅ Tested | ✅ Tested | Full support |
| **macOS** | ✅ Compatible | ✅ Compatible | bash + python3 standard |
| **Windows (WSL2)** | ✅ Use WSL2 | ✅ Use WSL2 | Native Linux env |
| **Windows (native cmd/PowerShell)** | ❌ NOT supported | ⚠️ Python scripts work, paths might break | bash setup.sh requires bash; native Windows uses backslash paths |

For native Windows users:
- The Python scripts (`run_structural.py`, `apply_fixes.py`, etc.) work in PowerShell, but path conventions differ.
- Use **WSL2** for the smoothest experience.
- The `setup.sh` installer requires bash — run it from WSL2 or git-bash.

If you must run on native Windows, install via manual `cp` (or PowerShell `Copy-Item`) and skip `setup.sh`.

## Running it

```bash
# Score any plan in your project
python3 .claude/skills/plan-confidence/scripts/run_structural.py {plan-slug}

# Or use the user-invokable Claude Code skill
/plan-confidence {plan-slug}

# Improve a plan iteratively
/plan-improve {plan-slug}
```

## Defaults bundled (fallback)

`.claude/skills/plan-confidence/defaults/`:
- `solid.md` — SOLID principles
- `dry.md` — Don't Repeat Yourself
- `clean-code.md` — Naming, function size, comments
- `loc-limits.md` — 500 LoC per file default
- `testing.md` — TDD as default discipline
- `README.md` — Explains fallback semantics

If `.claude/rules/` exists in your project, defaults are ignored. Project rules ALWAYS win.

## Customizing for your project

1. **Set your thresholds.** Edit `.claude/rules/plan-confidence-thresholds.txt` (after copying from `.example`). Adjust band cutoffs based on your team's calibration.

2. **Write your golden rule.** Edit `.claude/rules/plan-confidence-golden-rule.md`. Add domain-specific inviolable constraints.

3. **Add your own rule files.** Drop any `.md` in `.claude/rules/` — the compliance checker will recognize them. Plans that cite your rules get compliance credit.

4. **Manage the allowlist.** As your project accumulates plans that legitimately violate hard caps (e.g., follow-up notes without Coverage Matrix), add them to `.claude/rules/plan-confidence-allowlist.txt`.

## What's portable, what's project-specific

| Element | Portable? | Notes |
|---|---|---|
| Python scripts in `scripts/` | ✅ Fully | Auto-detect paths |
| Defaults bundle | ✅ Fully | Generic principles |
| Tests in `tests/` | ⚠️ Mostly | A few reference real plans; they skip gracefully |
| Templates in `templates/` | ✅ Fully | `.example.*` files |
| Score schema (JSON) | ✅ Fully | Generic `$id` |
| `/plan-improve` prompt template | ✅ Fully | Generic slugs |
| `check-plan-confidence.sh` | ✅ Fully | Auto-finds `.claude/` from script location |

## Troubleshooting

### "Plan not found" when invoking by slug
The auto-detector looks in `.claude/knowledge-base/plans/`, then `.claude/plans/`, then `plans/`, then `docs/plans/`. If your project uses a different directory, pass the full path to the `.md` file instead of just the slug.

### "Calibration WARN: PROVISIONAL_v1"
This is expected on a new project. The skill is signaling that the score band cutoffs are SOTA defaults and not yet calibrated against your project's holdout. Build the holdout in `.claude/knowledge-base/concepts/plan-confidence/holdout/` over time.

### Tests fail with "real plan not found"
These tests reference specific plans from the source project. They SKIP gracefully in your project — that's expected behavior.

## License

Same license as the source project where you got this. Copy responsibly.
