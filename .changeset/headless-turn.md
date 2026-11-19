---
'@theokit/agents': minor
---

`@theokit/agents/commands` adds `runHeadlessTurn` and `readHeadlessPrompt` for a one-shot CLI mode. `runHeadlessTurn` turns a stream of wire chunks into the final answer on stdout, progress on stderr (or canonical JSON lines with `json`), and an exit code: 0 for ok, 1 for an error or an empty turn, 2 for a turn cut by `step_limit` or `no_progress`.
