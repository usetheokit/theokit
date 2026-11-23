---
'@theokit/agents': minor
---

`runHeadlessTurn` takes `format`, a per-event formatter that replaces the built-in rendering (exit codes unchanged), and `readHeadlessPrompt` accepts `stdin: 'forced'`, which reads piped input even when a prompt argument (such as `-`) is present.
