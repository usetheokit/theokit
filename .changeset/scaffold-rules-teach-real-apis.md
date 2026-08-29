---
'create-theokit': patch
---

The scaffold's rules file and agent skill stop teaching three more names that do not exist.

Verifying the previous release against the published package rather than the working tree turned up
what the first sweep had missed. `.claude/rules/theokit-conventions.md` — a RULES file, which an
agent reads as normative rather than as an example — still prescribed `defineRoute`, `defineAction`
and `defineWebSocket`. The agents skill still built every example on `defineAgent`. None of the four
is exported by anything: the real surface is `route()`, `action()`, `websocket()` and
`AgentBuilder.create()`, which the generated app's own files already use.

The guard that should have caught them read only `import` lines from `theokit/…`, so it saw neither
prose in a rules file nor a scoped sibling. It now covers `@theokit/*` packages this workspace
builds, and derives what is verifiable from `packages/` rather than from a list — the first attempt
at a list immediately reported `@theokit/tui` and `@theokit/gateway-telegram`, which belong to other
repositories, as defects.
