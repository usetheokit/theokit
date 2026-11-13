---
'@theocode/agent': patch
'@theocode/cli': patch
'@theocode/tui': patch
---

The ACP entry now runs the same startup steps as the CLI and the TUI (project `.env`, `THEOCODE_HOME` / `home_dir`, credential store, `CLAUDE_PROJECT_DIR`) through one shared `bootstrapSurface` function in `@theocode/agent`.
