# Rules

Markdown files here are **path-scoped instructions**: they enter the agent's context only when the
conversation touches a file matching their `globs`. That is what separates a rule from `THEO.md`,
which is always present.

```markdown
---
description: what this rule is for
globs:
  - src/server/routes/**/*.ts
---

Your instructions here.
```

| Frontmatter   | Type     | Meaning                            |
| ------------- | -------- | ---------------------------------- |
| `description` | string   | what the rule covers               |
| `globs`       | string[] | paths that activate it             |
| `paths`       | string[] | same idea, explicit paths          |
| `alwaysApply` | boolean  | ignore the globs and always attach |
| `enabled`     | boolean  | switch it off without deleting it  |

A file with **no frontmatter at all** is treated as `alwaysApply: true`. That is a convenience worth
knowing about and easy to trigger by accident: a rule you meant to scope, whose frontmatter has a
typo, becomes a rule that fires on every turn.

Rules load at priority 45 — after `CLAUDE.md` (30) and `.cursor/rules` (40), before
`.theokit/context` (50) and `THEO.md` (60).
