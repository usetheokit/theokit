---
'create-theokit': patch
---

**`THEO.md` explains why it lives under `.theokit/` and not at the project root** (#642).

The question the issue asked — one context file or two, now that the SDK can read a root
`THEO.md` — is answered in the file itself, tied to the version that decides it:

- On the SDK this template pins (`^4.52.1`), `.theokit/THEO.md` is the **only** path a `THEO.md` is
  read from. A copy at the root is read by nothing, silently.
- `@theokit/sdk@5` adds a root spec at priority 55 (`theokit-sdk#531`), so both work there and
  `.theokit/` still wins a conflict. 5.x is on the `next` channel only, so moving the file would
  break it for anyone on the default install.

**The pair stays, and the reason is audience rather than the SDK.** `AGENTS.md` addresses agents
that *write* the code and is read by Cursor, Copilot and Claude Code as well; `THEO.md` addresses
the agent that talks to *users*. That distinction predates the SDK limitation and outlives it, so
the two files are a design rather than a leftover workaround — which is exactly what #642 was filed
to prevent them from quietly becoming.

Also recorded, for whoever moves the file once 5.x is stable: the root spec sets
`followImports: true` and `.theokit/THEO.md` does not, so `@file` references resolve in one and not
the other.

`theo-md-location.test.ts` ties the prose to the manifest — it reads the SDK range out of
`package.json.tmpl` and asserts the explanation cites it. Moving the pin past 4.x fails the test,
so the note has to be revisited instead of outliving its own premise.
