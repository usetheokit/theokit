# ast-grep — Portable Installation

This skill is **fully portable**. The skill itself ships only YAML rule files + bash setup; the binary is installed once per machine.

## Quick install

```bash
# In any project that has Claude Code skills:
cp -r /path/to/source/.claude/skills/ast-grep .claude/skills/
bash .claude/skills/ast-grep/setup.sh
```

The `setup.sh` checks for `ast-grep` in PATH; if missing, prints the install command for your platform.

## Binary install — choose one

| Method | Command | Notes |
|---|---|---|
| **npm** (recommended for Node projects) | `npm install -g @ast-grep/cli` | Goes into your nvm prefix; no sudo |
| **npm devDependency** | Add `"@ast-grep/cli": "^0.42"` to `package.json` devDependencies | When project has `package.json`. Run via `npx ast-grep ...` to ensure project-pinned version |
| **Cargo** | `cargo install ast-grep --locked` | Rust toolchain required |
| **Homebrew** (macOS) | `brew install ast-grep` | Easiest on Mac |
| **Pre-built binary** | Download from <https://github.com/ast-grep/ast-grep/releases> | Air-gapped environments |

For the OurProject project specifically: when `package.json` is created (post-v0.0), add `@ast-grep/cli` to `devDependencies` so the pinned version travels with the project.

## Linux naming collision

`/usr/bin/sg` is the `switch group` command (shadow-utils). The ast-grep binary is also called `sg`, but is installed by npm into `~/.nvm/versions/node/<v>/bin/sg`, which appears earlier in PATH.

**Best practice**: use the `ast-grep` long name in all scripts and rule invocations. The skill's allow-list in `.claude/settings.json` includes both `Bash(ast-grep *)` and `Bash(sg *)`, but prefer the long form for clarity.

## What's portable, what's project-specific

| Element | Portable? | Notes |
|---|---|---|
| YAML rule files (`rules/*.yml`) | ✅ Fully | Generic — TS / Python patterns work in any codebase |
| `setup.sh` | ✅ Fully | Auto-detects ast-grep, prints install command if missing |
| `SKILL.md` two-phase workflow (zoom out → zoom in) | ✅ Fully | Investigation pattern is language-agnostic |
| References to `.claude/knowledge-base/references/` in examples | ❌ Project-specific | The example commands cite OurProject's reference clones; adapt to your tree |

## Customization

1. **Add project-specific rules.** Drop new `.yml` files into `rules/`. Naming convention: `<intent>-<language>.yml`.
2. **Override the workflow guidance.** Edit `SKILL.md` § "Workflow: zoom out → zoom in" — the heuristic is project-shaped; your project may have different ratios of structural vs textual queries (e.g., a docs-heavy project will skip Fase A more often).
3. **Integrate into other skills.** This skill is composable. Any other skill prompt can include: "when querying code structure, prefer `/ast-grep` patterns; the rule files at `.claude/skills/ast-grep/rules/` are pre-validated."

## Sanity check (after install)

```bash
ast-grep --version
ast-grep scan --rule .claude/skills/ast-grep/rules/class-extends-ts.yml \
  .claude/skills/ast-grep/  # safe self-scan
```

The self-scan should run cleanly (zero matches expected — no TS files in the skill itself, but the parser will execute without error).
