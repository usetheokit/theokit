---
'@theokit/agents': patch
---

Add coverage tests that every published export entry has a section in `docs/capability-map.md` and that the config section lists `InstructionCut`, `InstructionTrim` and `InstructionTreeBudget` as types. The committed map was verified current with the generator's `--check` mode; it needed no change.
