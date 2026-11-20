---
'create-theokit': minor
---

Add `--surface=cli`: scaffolds a one-shot command that takes a prompt (argument and/or stdin), runs one in-process agent turn through `runHeadlessTurn`, prints the answer, supports `--json` and `-o <file>`, and sets the exit code.
