---
"create-theokit": minor
---

Componentize the scaffolded TUI surface. `tui/App.tsx` drops from 460 to 230 lines and becomes a focused composition root; the welcome `Banner`, the `/usage` observability panel (`UsagePanel`), and the `/plan /ask /select /progress` showcase (`Demos`, which owns its own progress timer) move to `tui/components/*` — each single-responsibility and, for the demos, deletable in one file. The generated app ships a `## Architecture` System Design in `README-surface.md` (component tree + data flow + layer boundaries + extension points). Pure refactor: every 1.22.0 behavior is preserved (Stack layout, PermissionPrompt HITL, `/usage` from real usage, the four demos, Toast, two-step Ctrl+C, Esc routing); the generated app typechecks against the 0.40.0 types with zero unused imports and no `as` type assertions (the slash-command router uses explicit type-safe cases).
