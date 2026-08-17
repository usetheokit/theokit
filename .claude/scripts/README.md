# scripts/

Utility scripts consumed by skills, hooks, and commands. None of these are user-invocable directly — they are infrastructure.

## Inventory

| Script | Consumed by | Purpose |
|---|---|---|
| `attest-plan.sh` | `commands/plan-attest.md` | Computes SHA256 of a plan file and writes it to `.attestations/{slug}.sha256` atomically (temp file + rename). Supports `--all` (attest every plan), `--verify` (read-only check). Dual-mode: standalone or `.claude/`-wrapped. |
| `statusline.sh` | `settings.json` (`statusLine.command`) | Renders the Claude Code status line as `<git-branch[*=dirty]> | <plan-slug> | <ralph-loop:iter or ->`. Never run directly; Claude Code invokes it. |
| `check_xrefs.py` | Manual / CI | Validates cross-references between cycle rules, SKILL.md files, and templates. Dual-mode: detects standalone (`skills/` + `rules/` + `hooks/`) or `.claude/`-wrapped layout. Run periodically to detect broken links after edits. |
| `session-catchup.py` | Recovery after `hooks/precompact-preserve.sh` | Rebuilds context from snapshots under `.compaction-snapshots/` + recent progress entries. Useful when the foreground session has been compacted and needs to resume mid-plan. |
| `test_e2e_smoke.py` | Manual / CI | End-to-end smoke test that exercises the pipeline against a synthetic plan. Used to validate that hook + skill wiring still works after refactors. |

## When to run them

- **`attest-plan.sh`** — never run directly; let `/plan-attest` invoke it.
- **`statusline.sh`** — never run directly; Claude Code invokes it via `settings.json` `statusLine.command`.
- **`check_xrefs.py`** — run after any edit to `rules/*.md` or `skills/*/SKILL.md` to catch broken references.
- **`session-catchup.py`** — run after PreCompact has fired and you want to brief a fresh session on the active plan + recent progress.
- **`test_e2e_smoke.py`** — run when modifying hooks, settings, or the cycle rules themselves.

## Adding a new script

- Place the script here only if it is shared by multiple skills OR if it is hook/command infrastructure.
- Skill-private scripts live under `skills/{name}/scripts/`.
- Every new script in this directory MUST be added to the inventory above.
