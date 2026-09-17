---
'@theokit/agents': minor
---

`FOREIGN_KEY_DECISIONS` records what this package does with each `.claude/settings.json` key its
diagnostics name, and why — `honoured` or `refused`, each with a reason about this product rather
than about the reference.

`model` and `cleanupPeriodDays` join the settings schema as honoured keys. Reporting a key as "not
implemented here" says the code does not act on it; it never says whether that is a refusal or an
omission, and an author reading it cannot tell whether to stop writing the key or to wait for it.
