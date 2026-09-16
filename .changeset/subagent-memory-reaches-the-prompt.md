---
"@theokit/agents": minor
---

`applySubagentMemory` — a subagent's `memory:` declaration now reaches the prompt it governs.

`@theokit/sdk` carries the declaration and deliberately stops there: which of three roots a note
lives under is a decision about who can see it, and a second copy of that rule in that package is
how two packages drift into disagreeing about privacy. `resolveAgentMemory` owned that decision
here — and owned it with no caller. The reader and the declaration were one call apart for as long
as both existed.

The three roots are decided together, because they differ in exactly one way — who can see the
notes — so defaulting an unrecognised scope would publish, on the next commit, something somebody
wrote expecting privacy. An unrecognised scope therefore throws rather than guessing.
