---
type: defaults-bundle
created_at: 2026-05-17
purpose: Fallback engineering principles when project has no `.claude/rules/`
---

# Default Engineering Principles (FALLBACK ONLY)

**This directory is FALLBACK.** If `.claude/rules/` exists in the project, these defaults are IGNORED. Project rules are the source of truth.

The skills (`/to-plan`, `/plan-confidence`, `/plan-improve`) check `.claude/rules/` FIRST. Only when that directory is missing or empty do they fall back to:

- `solid.md` — SOLID principles (SRP, OCP, LSP, ISP, DIP)
- `dry.md` — Don't Repeat Yourself
- `clean-code.md` — naming, function size, comments, dead code
- `loc-limits.md` — file size budget (~500 LoC default)
- `testing.md` — TDD default (RED → GREEN → REFACTOR)

When the chain runs in a project WITH `.claude/rules/`, these documents are NOT loaded. The agent reads the project rules directly.

## How fallback is detected

```python
PROJECT_RULES = Path(".claude/rules")
DEFAULTS = Path(".claude/skills/plan-confidence/defaults")

def get_active_rules() -> list[Path]:
    if PROJECT_RULES.exists() and any(PROJECT_RULES.glob("*.md")):
        return list(PROJECT_RULES.glob("*.md"))
    return list(DEFAULTS.glob("*.md"))
```

Project rules win. Always.
