---
"@theokit/agents": minor
---

The environment variables this package reads are now a CLOSED list in the README, gated both ways.

An operator exported a variable and nothing happened, and there was no way to tell "this runtime does
not read it" from "it read it and my value was wrong". `rules/foreign-config-surfaces.md` settles
that for `.claude/` file surfaces in one sentence — *a surface is read, or it is refused with a
reason about this product; it is never accepted and ignored* — and the environment was the largest
surface that sentence did not cover.

**The list is closed, and that is the part worth having.** A variable absent from the table is not
read by this package — not "undocumented", not "read somewhere else". One sentence answers for every
variable anyone could export, including the ones nobody enumerated.

| Variable | Security | What it changes |
|---|---|---|
| `PROGRAMDATA` | no | where the machine-wide operator policy is looked for on Windows |
| `THEOKIT_CODEX_CLIENT_ID` | **yes** | which OAuth client the Codex device authorisation is issued against |
| `THEOKIT_DEBUG` | no | debug logging (the logs can carry request shapes) |

**Three, not two.** `THEOKIT_CODEX_CLIENT_ID` is read through a constant rather than a literal
(`src/auth/device-provider.ts:97`, constant at `:93`), so it is invisible to any scan matching only
`process.env.X` — and it is the one of the three that touches a credential path. A gate that missed
it would have signed off on an incomplete list, producing from inside the gate the exact silence the
list exists to remove.

**The security column is a decision per row, not a keyword match.** A name containing `AWS` can be a
plain address, and a name matching nothing can disable a control.

`node scripts/check-env-verdicts.mjs` fails in **both** directions — a variable read and not listed,
and a variable listed that nothing reads any more. The second is the quieter failure: after a
refactor deletes the only read, the table keeps advertising a variable that does nothing, and no
operator can detect that by experiment. The gate uses node's stdlib only, makes no network call, and
reads nothing outside this repository.
